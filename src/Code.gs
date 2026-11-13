/**
 * Rudern Backend: boat sign-ups for calendar events whose description
 * contains the marker text (default "@anmeldung").
 *
 * Tabs: Boote (admin), Termine (script), Anmeldungen (script).
 * Script properties: TOKEN, CALENDAR_ID, MARKER, LOCK_HOURS, PAGE_URL.
 * Entry points: doGet, doPost (web app), syncEvents (10-min trigger),
 * onEditInstalled (edit trigger), setup (run once by hand).
 */

const TAB_BOATS = 'Boote';
const TAB_SESSIONS = 'Termine';
const TAB_SIGNUPS = 'Anmeldungen';
const HEADERS = {
  Boote: ['Name', 'Boot_ID', 'Klasse', 'Typ', 'Steuerperson', 'Befahrbar', 'Bemerkungen', 'Farbe'],
  Termine: ['Name', 'Termin_ID', 'Datum', 'Beginn', 'Ende', 'Status'],
  Anmeldungen: ['Termin_ID', 'Mitglied_ID', 'Boot_ID', 'Platz', 'Prio', 'Geandert'],
};
const DAYS_AHEAD = 14;
const CAT_PREFIX = 'cat:';
const UNSURE_ID = CAT_PREFIX + 'unsure';  // "Noch ohne Wahl"
const COX_SEAT = 'St';
const MARK_START = '--- Boote ---';
const MARK_END = '--- Ende ---';

const props = PropertiesService.getScriptProperties();
const cache = CacheService.getScriptCache();

// ---------- helpers ----------

function cfg_(key, fallback) {
  const v = props.getProperty(key);
  return v === null || v.trim() === '' ? fallback : v.trim();
}

function fmt_(v, pattern) {
  return v instanceof Date
    ? Utilities.formatDate(v, Session.getScriptTimeZone(), pattern)
    : String(v).trim();
}

function yes_(v, fallback) {
  if (v === '' || v === null || v === undefined) return fallback;
  return v === true || /^(ja|j|yes|y|true|x|1)$/i.test(String(v).trim());
}

const COLORS = ['Lila', 'Gruen', 'Blau', 'Gelb', 'Weiss', 'Rot', 'Braun'];

// Hull colour from the sheet's `Farbe` column; '' when empty or not one of COLORS.
function color_(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase()
    .replace('ü', 'ue').replace('ß', 'ss');
  return COLORS.find((c) => c.toLowerCase() === s) || '';
}

function seats_(klasse) {
  const m = String(klasse).match(/\d+/);
  return m ? Number(m[0]) : 0;
}

function startMs_(date, time) {
  return Utilities.parseDate(
    date + ' ' + (time || '00:00'), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm',
  ).getTime();
}

function read_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Tab not found: ' + name);
  const values = sh.getDataRange().getValues();
  const header = values.shift().map((h) => String(h).trim());
  const rows = values
    .map((r, i) => {
      const o = {_row: i + 2};
      header.forEach((h, j) => { o[h] = r[j]; });
      return o;
    })
    .filter((o) => header.some((h) => o[h] !== ''));
  return {sh, header, rows};
}

function append_(t, obj) {
  t.sh.appendRow(t.header.map((h) => (h in obj ? obj[h] : '')));
}

function update_(t, row, obj) {
  t.header.forEach((h, j) => {
    if (h in obj) t.sh.getRange(row._row, j + 1).setValue(obj[h]);
  });
}

function deleteRows_(t, rows) {
  rows.map((r) => r._row).sort((a, b) => b - a).forEach((n) => t.sh.deleteRow(n));
}

function hash_(text) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text));
}

function bump_() {
  props.setProperty('VERSION', String(Number(cfg_('VERSION', '1')) + 1));
  cache.remove('state');
}

// Status values as they appear in the Sheet dropdown. Compared case-insensitively so that
// "Abgesagt", "abgesagt" and "ABGESAGT" all mean the same; the API always gets lowercase.
const STATUS_ACTIVE = 'Aktiv';
const STATUS_CANCELLED = 'Abgesagt';

function isCancelled_(status) {
  return String(status || '').trim().toLowerCase() === STATUS_CANCELLED.toLowerCase();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- state ----------

function buildState_() {
  const now = Date.now();
  const lockMs = Number(cfg_('LOCK_HOURS', '2')) * 3600e3;
  const today = fmt_(new Date(), 'yyyy-MM-dd');

  const boats = read_(TAB_BOATS).rows
    .map((r) => ({
      boat_id: String(r.Boot_ID).trim(),
      name: String(r.Name).trim(),
      klasse: String(r.Klasse).trim(),
      typ: String(r.Typ).trim(),
      seats: seats_(r.Klasse),
      cox: yes_(r.Steuerperson, false),
      bookable: yes_(r.Befahrbar, true),
      notes: String(r.Bemerkungen).trim(),
      color: color_(r.Farbe),
    }))
    .filter((b) => b.boat_id);

  const sessions = read_(TAB_SESSIONS).rows
    .map((r) => {
      const date = fmt_(r.Datum, 'yyyy-MM-dd');
      const start = fmt_(r.Beginn, 'HH:mm');
      return {
        session_id: String(r.Termin_ID),
        name: String(r.Name),
        date,
        start,
        end: fmt_(r.Ende, 'HH:mm'),
        status: isCancelled_(r.Status) ? 'abgesagt' : 'aktiv',
        locked: startMs_(date, start) - lockMs < now,
      };
    })
    .filter((s) => s.session_id && s.date >= today)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  const ids = new Set(sessions.map((s) => s.session_id));
  const signups = read_(TAB_SIGNUPS).rows
    .filter((r) => ids.has(String(r.Termin_ID)))
    .map((r) => ({
      session_id: String(r.Termin_ID),
      member_id: String(r.Mitglied_ID),
      boat_id: String(r.Boot_ID),
      seat: r.Platz === '' ? null : String(r.Platz),
      rank: r.Prio === '' ? null : Number(r.Prio),
    }));

  return {ok: true, version: cfg_('VERSION', '1'), boats, sessions, signups};
}

function getState_() {
  const hit = cache.get('state');
  if (hit) return JSON.parse(hit);
  const state = buildState_();
  cache.put('state', JSON.stringify(state), 30);
  return state;
}

// ---------- web app ----------

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ok: false, error: 'bad_json'});
  }
  return handle_(body);
}

function handle_(p) {
  const token = cfg_('TOKEN', null);
  if (!token || p.t !== token) return json_({ok: false, error: 'forbidden'});
  try {
    if (p.action === 'state') return json_(getState_());
    if (p.action === 'set' || p.action === 'remove') return json_(write_(p));
    return json_({ok: false, error: 'unknown_action'});
  } catch (err) {
    return json_({ok: false, error: String((err && err.message) || err)});
  }
}

function write_(p) {
  const member = String(p.member_id || '').trim().replace(/\s+/g, ' ');
  if (!member || member.length > 40) return {ok: false, error: 'bad_name'};

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const state = buildState_();
    const session = state.sessions.find((s) => s.session_id === String(p.session_id));
    if (!session) return {ok: false, error: 'unknown_session'};
    if (session.status !== 'aktiv') return {ok: false, error: 'cancelled'};
    if (session.locked) return {ok: false, error: 'locked'};
    const boatId = String(p.boat_id);
    const hasSeat = p.seat !== undefined && p.seat !== null && p.seat !== '';
    const seat = hasSeat ? String(p.seat) : '';

    const t = read_(TAB_SIGNUPS);
    const inSession = (r) => String(r.Termin_ID) === session.session_id;
    const mine = (r) => inSession(r) &&
      String(r.Mitglied_ID).toLowerCase() === member.toLowerCase();
    const stamp = fmt_(new Date(), "yyyy-MM-dd'T'HH:mm:ss");

    if (p.action === 'remove') {
      // Give up exactly this choice (a seat, or a whole category / "unsure").
      deleteRows_(t, t.rows.filter((r) => mine(r) && String(r.Boot_ID) === boatId &&
        String(r.Platz) === seat));
    } else {
      // One choice per member and session: a new choice replaces the old one.
      if (hasSeat) {
        const boat = state.boats.find((b) => b.boat_id === boatId);
        if (!boat) return {ok: false, error: 'unknown_boat'};
        if (!boat.bookable) return {ok: false, error: 'boat_unavailable'};
        const valid = (seat === COX_SEAT && boat.cox) ||
          (/^\d+$/.test(seat) && Number(seat) >= 1 && Number(seat) <= boat.seats);
        if (!valid) return {ok: false, error: 'bad_seat'};
        const taken = t.rows.some((r) => inSession(r) && !mine(r) &&
          String(r.Boot_ID) === boatId && String(r.Platz) === seat);
        if (taken) return {ok: false, error: 'seat_taken'};
      } else if (boatId !== UNSURE_ID) {
        // Whole category 'cat:<typ>|<klasse>': needs at least one bookable boat.
        const known = boatId.indexOf(CAT_PREFIX) === 0 && state.boats.some((b) =>
          b.bookable && CAT_PREFIX + b.typ + '|' + b.klasse === boatId);
        if (!known) return {ok: false, error: 'unknown_boat'};
      }
      deleteRows_(t, t.rows.filter(mine));
      append_(t, {Termin_ID: session.session_id, Mitglied_ID: member,
        Boot_ID: boatId, Platz: seat, Prio: '', Geandert: stamp});
    }
    bump_();
    return {ok: true, version: cfg_('VERSION', '1')};
  } finally {
    lock.releaseLock();
  }
}

// ---------- calendar sync ----------

function listEvents_(calId) {
  const now = new Date();
  // Start at midnight (script time zone), not "now": events earlier today must stay in the window.
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const until = new Date(from.getTime() + DAYS_AHEAD * 864e5);
  const items = [];
  let pageToken;
  do {
    const res = Calendar.Events.list(calId, {
      timeMin: from.toISOString(),
      timeMax: until.toISOString(),
      singleEvents: true,
      showDeleted: true,
      maxResults: 250,
      pageToken: pageToken,
    });
    (res.items || []).forEach((ev) => items.push(ev));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return items;
}

function lineupBlock_(sessionId, signups, boatNames) {
  const link = cfg_('PAGE_URL', '') + '#t=' + cfg_('TOKEN', '') +
    '&s=' + encodeURIComponent(sessionId);
  const lines = [MARK_START, 'Anmeldung: ' + link];
  const byBoat = {};
  signups.filter((r) => String(r.Termin_ID) === sessionId).forEach((r) => {
    const id = String(r.Boot_ID);
    (byBoat[id] = byBoat[id] || []).push(r);
  });
  Object.keys(byBoat).sort().forEach((id) => {
    const rows = byBoat[id];
    const seatKey = (r) => (String(r.Platz) === COX_SEAT ? 99 : Number(r.Platz));
    const seats = rows.filter((r) => String(r.Platz) !== '')
      .sort((a, b) => seatKey(a) - seatKey(b))
      .map((r) => r.Platz + ' ' + r.Mitglied_ID);
    const others = rows.filter((r) => String(r.Platz) === '').map((r) => r.Mitglied_ID);
    const label = id === UNSURE_ID ? 'Noch ohne Wahl'
      : id.indexOf(CAT_PREFIX) === 0 ? 'Egal welches Boot, ' + id.slice(CAT_PREFIX.length).replace('|', ' ')
        : (boatNames[id] || id);
    lines.push(label + ': ' + seats.concat(others).join(', '));
  });
  lines.push(MARK_END);
  return lines.join('\n');
}

function withBlock_(description, block) {
  const desc = description || '';
  const i = desc.indexOf(MARK_START);
  const j = desc.indexOf(MARK_END);
  const base = i >= 0 && j > i
    ? (desc.slice(0, i) + desc.slice(j + MARK_END.length)).trim()
    : desc.trim();
  return (base ? base + '\n\n' : '') + block;
}

function hasMarker_(description, marker) {
  // Ignore our own block and HTML tags; compare case-insensitively.
  const text = withBlock_(description, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  return text.toLowerCase().indexOf(marker) >= 0;
}

function syncEvents() {
  const calId = cfg_('CALENDAR_ID', null);
  if (!calId) throw new Error('Script property CALENDAR_ID is missing');
  const marker = cfg_('MARKER', '@anmeldung').toLowerCase().replace(/\s+/g, ' ');
  const events = listEvents_(calId);

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t = read_(TAB_SESSIONS);
    const byId = new Map(t.rows.map((r) => [String(r.Termin_ID), r]));
    const signups = read_(TAB_SIGNUPS).rows;
    const boatNames = {};
    read_(TAB_BOATS).rows.forEach((r) => {
      boatNames[String(r.Boot_ID).trim()] = String(r.Name).trim() + ' (' + String(r.Klasse).trim() + ')';
    });
    const written = JSON.parse(cfg_('WRITTEN_BLOCKS', '{}'));
    const nextWritten = {};
    let changed = false;

    events.forEach((ev) => {
      const existing = byId.get(ev.id);
      const title = String(ev.summary || '');
      const isMatch = ev.status !== 'cancelled' && hasMarker_(ev.description, marker) &&
        ev.start && ev.start.dateTime;

      if (!isMatch) {
        // Deleted, marker removed or turned into an all-day event: cancel the session.
        if (existing && !isCancelled_(existing.Status)) {
          update_(t, existing, {Status: STATUS_CANCELLED});
          changed = true;
        }
        // Marker removed from a live event: take our block out of its description.
        if (ev.status !== 'cancelled' && written[ev.id]) {
          Calendar.Events.patch({description: withBlock_(ev.description, '').trim()}, calId, ev.id);
        }
        return;
      }

      const start = new Date(ev.start.dateTime);
      const end = new Date(ev.end.dateTime);
      const row = {
        Name: title,
        Termin_ID: ev.id,
        Datum: fmt_(start, 'yyyy-MM-dd'),
        Beginn: fmt_(start, 'HH:mm'),
        Ende: fmt_(end, 'HH:mm'),
        Status: STATUS_ACTIVE,
      };
      if (!existing) {
        append_(t, row);
        changed = true;
      } else {
        const now = {
          Name: String(existing.Name),
          Datum: fmt_(existing.Datum, 'yyyy-MM-dd'),
          Beginn: fmt_(existing.Beginn, 'HH:mm'),
          Ende: fmt_(existing.Ende, 'HH:mm'),
        };
        // A matching event is live again (e.g. the marker was re-added): reactivate, but never
        // rewrite the status text just because of capitalisation.
        if (isCancelled_(existing.Status)) now.Status = String(existing.Status);
        else row.Status = String(existing.Status || STATUS_ACTIVE);
        if (Object.keys(now).some((k) => now[k] !== row[k])) {
          update_(t, existing, row);
          changed = true;
        }
      }

      // Rewrite the description block only when its content changed.
      const block = lineupBlock_(ev.id, signups, boatNames);
      const digest = hash_(block);
      nextWritten[ev.id] = digest;
      if (written[ev.id] !== digest) {
        Calendar.Events.patch({description: withBlock_(ev.description, block)}, calId, ev.id);
      }
    });

    props.setProperty('WRITTEN_BLOCKS', JSON.stringify(nextWritten));
    if (changed) bump_();
  } finally {
    lock.releaseLock();
  }
}

// ---------- triggers and setup ----------

function onEditInstalled() {
  bump_();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach((name) => {
    const t = read_(name);
    const missing = HEADERS[name].filter((h) => t.header.indexOf(h) < 0);
    if (missing.length) throw new Error(name + ': missing columns ' + missing.join(', '));
  });

  // Keep IDs, dates and times as plain text so the Sheet does not convert them.
  [[TAB_SESSIONS, ['Termin_ID', 'Datum', 'Beginn', 'Ende']],
    [TAB_SIGNUPS, ['Termin_ID', 'Mitglied_ID', 'Boot_ID', 'Platz', 'Geandert']]]
    .forEach(([name, cols]) => {
      const t = read_(name);
      cols.forEach((c) => {
        const col = t.header.indexOf(c) + 1;
        t.sh.getRange(2, col, t.sh.getMaxRows() - 1, 1).setNumberFormat('@');
      });
    });

  if (!cfg_('TOKEN', null)) {
    props.setProperty('TOKEN', Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  }
  if (!cfg_('VERSION', null)) props.setProperty('VERSION', '1');

  ScriptApp.getProjectTriggers().forEach((tr) => ScriptApp.deleteTrigger(tr));
  ScriptApp.newTrigger('syncEvents').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss).onEdit().create();

  syncEvents();
  Logger.log('TOKEN: ' + cfg_('TOKEN', ''));
  Logger.log('Member link: ' + cfg_('PAGE_URL', '<set PAGE_URL>') + '#t=' + cfg_('TOKEN', ''));
}

// Diagnostic: lists the calendars this account can see, with their IDs.
function listCalendars() {
  Calendar.CalendarList.list().items.forEach((c) =>
    Logger.log(c.summary + ' | ' + c.id + ' | ' + c.accessRole));
}
