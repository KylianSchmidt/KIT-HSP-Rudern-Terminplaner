// Date/time labels, name helpers, WhatsApp text and all UI strings.

export const STR = {
  nameLabel: 'Dein Name',
  needName: 'Bitte zuerst deinen Namen eingeben',
  noToken: 'Bitte öffne den Link aus der WhatsApp-Gruppe.',
  noSessions: 'Gerade sind keine Termine zur Anmeldung offen.',
  cancelled: 'abgesagt',
  locked: 'Anmeldung geschlossen',
  notBookable: 'nicht befahrbar',
  myDates: 'Meine Termine',
  share: 'In WhatsApp teilen',
  offline: 'Keine Verbindung, bitte erneut versuchen',
  err: {
    seat_taken: 'Der Platz wurde gerade vergeben.',
    locked: 'Die Anmeldung für diesen Termin ist geschlossen.',
    cancelled: 'Dieser Termin wurde abgesagt.',
    boat_unavailable: 'Dieses Boot ist gerade nicht befahrbar.',
    forbidden: 'Der Link ist ungültig. Bitte den aktuellen Link aus der WhatsApp-Gruppe öffnen.',
    bad_name: 'Bitte einen Namen mit höchstens 40 Zeichen eingeben.',
    default: 'Das hat nicht geklappt. Bitte erneut versuchen.',
  },
  // Texts beyond the spec table
  loading: 'Lade Termine …',
  retry: 'Erneut versuchen',
  inBoat: 'Im Boot',
  nobody: 'Noch niemand angemeldet',
  noneMine: 'Du bist noch für keinen Termin angemeldet.',
  seatN: (seat) => (seat === 'St' ? 'Steuerplatz' : `Platz ${seat}`),
  free: 'frei',
  boatDiagram: (name) => `Boot ${name}`,
  sessions: 'Termine',
  full: 'Boot voll',
  fullShort: 'Voll',
  pool: 'Noch ohne Wahl',
  anyBoat: 'Egal welches Boot',
};

export function errText(code) {
  if (code === 'network') return STR.offline;
  return STR.err[code] || STR.err.default;
}

// Same normalisation as the backend: trim, collapse inner spaces.
export function normName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

export function sameName(a, b) {
  return normName(a).toLowerCase() === normName(b).toLowerCase();
}

export function initials(name) {
  const words = normName(name).split(' ').filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) {
    const w = Array.from(words[0]);
    return (w[0] + (w[1] || '')).replace(/^./, (c) => c.toUpperCase());
  }
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

// "Anna Weber" -> "Anna W."
export function shortName(name) {
  const words = normName(name).split(' ').filter(Boolean);
  if (words.length < 2) return words[0] || '';
  return `${words[0]} ${Array.from(words[words.length - 1])[0].toUpperCase()}.`;
}

const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pad = (n) => String(n).padStart(2, '0');

// "Di 17.11. 18:00"
export function sessionLabel(s) {
  const [y, m, d] = String(s.date).slice(0, 10).split('-').map(Number);
  const day = DAYS[new Date(y, m - 1, d).getDay()];
  return `${day} ${pad(d)}.${pad(m)}. ${s.start}`;
}

// Seats sort by number, the cox seat last.
export function seatOrder(seat) {
  return seat === 'St' ? 99 : Number(seat);
}

// "Anna W. (1), Ben K. (2), Carl S. (St)"
export function seatList(rows) {
  return rows
    .filter((r) => r.seat !== null)
    .sort((a, b) => seatOrder(a.seat) - seatOrder(b.seat))
    .map((r) => `${shortName(r.member_id)} (${r.seat})`);
}

// Session label, one line per boat with people, then the page link (without the token).
export function whatsappText(session, boats, signups, pageUrl) {
  const lines = [sessionLabel(session)];
  const rows = signups.filter((r) => r.session_id === session.session_id);
  boats.forEach((boat) => {
    const people = rows.filter((r) => r.boat_id === boat.boat_id && r.seat !== null)
      .sort((a, b) => seatOrder(a.seat) - seatOrder(b.seat))
      .map((r) => `${shortName(r.member_id)} (${r.seat})`);
    if (people.length) lines.push(`${boat.name} (${boat.klasse}): ${people.join(', ')}`);
  });
  lines.push('', pageUrl);
  return lines.join('\n');
}
