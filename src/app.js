// Root component: state, routing by hash, optimistic writes, polling.
import {html, render, useCallback, useEffect, useMemo, useRef, useState} from './vendor/standalone.module.js';
import * as api from './api.js';
import {
  STR, errText, normName, sameName, sessionLabel, seatList, initials, whatsappText,
} from './format.js';
import {CAT_PREFIX, UNSURE_ID, isCat, groupBoats, applyOp} from './choices.js';
import {BoatDiagram} from './boat.js';
import {Weather} from './weather.js';

const POLL_MS = 30000;
const TOAST_MS = 4000;
const KEY_TOKEN = 'rudern.token';
const KEY_NAME = 'rudern.name';
const KEY_STATE = 'rudern.state';
const EMPTY = {boats: [], sessions: [], signups: [], version: null};

// localStorage can throw (private mode, blocked storage); the app works without it.
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) { /* ignore */ }
  },
};

// Some apps percent-encode the whole fragment ("#t%3Dabc"); undo that so the link still works.
function readHash() {
  let raw = location.hash.slice(1);
  if (!raw.includes('=')) {
    try {
      raw = decodeURIComponent(raw);
    } catch (err) { /* keep raw */ }
  }
  return new URLSearchParams(raw);
}

// A token in the hash always wins over the stored one.
function readToken() {
  if (readHash().has('mock')) return 'mock';
  const fromHash = readHash().get('t');
  if (fromHash) {
    store.set(KEY_TOKEN, fromHash);
    return fromHash;
  }
  return store.get(KEY_TOKEN) || '';
}

function loadCached() {
  try {
    const s = JSON.parse(store.get(KEY_STATE));
    if (s && Array.isArray(s.boats) && Array.isArray(s.sessions) && Array.isArray(s.signups)) return s;
  } catch (err) { /* no cache */ }
  return null;
}

let nextOpId = 0;

function App() {
  const [token, setToken] = useState(readToken);
  useEffect(() => {
    const onHash = () => setToken(readToken());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  if (!token) return html`<main class="info notoken"><p>${STR.noToken}</p></main>`;
  return html`<${Main} token=${token} />`;
}

function Main({token}) {
  const [core, setCore] = useState(() => ({server: loadCached() || EMPTY, ops: []}));
  const coreRef = useRef(core);
  const update = (fn) => {
    coreRef.current = fn(coreRef.current);
    setCore(coreRef.current);
  };
  const [status, setStatus] = useState(core.server.version === null ? 'loading' : 'ok');
  const [fatal, setFatal] = useState('');
  const [name, setName] = useState(() => store.get(KEY_NAME) || '');
  const [sid, setSid] = useState(() => readHash().get('s') || '');
  const [toast, setToast] = useState('');
  const [showMine, setShowMine] = useState(false);
  const [jump, setJump] = useState(null);   // {sid, id, n}: scroll to and flash a boat after rendering
  const nameRef = useRef(null);
  const tabsRef = useRef(null);
  const toastTimer = useRef(0);
  const epoch = useRef(0);     // bumped around every write; older fetches are discarded
  const queue = useRef(Promise.resolve());

  const {server, ops} = core;
  const me = normName(name);
  const signups = useMemo(() => ops.reduce((acc, op) => applyOp(acc, op), server.signups), [server, ops]);
  const {boats, sessions} = server;
  const current = sessions.find((s) => s.session_id === sid)
    || sessions.find((s) => s.status === 'aktiv') || sessions[0] || null;
  const currentId = current ? current.session_id : '';

  const showToast = (text, ms = TOAST_MS) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(''), ms);
  };

  const refresh = useCallback(async () => {
    const startedAt = epoch.current;
    try {
      const data = await api.getState(token);
      setFatal('');
      setStatus('ok');
      // A response that raced with a write may be stale; the write refetches afterwards.
      if (startedAt !== epoch.current || coreRef.current.ops.length) return;
      const cur = coreRef.current.server;
      if (data.version !== cur.version) {
        update((c) => ({...c, server: {boats: data.boats, sessions: data.sessions, signups: data.signups, version: data.version}}));
      } else if (JSON.stringify(data.sessions) !== JSON.stringify(cur.sessions)) {
        // Same version, but `locked` changes with time alone.
        update((c) => ({...c, server: {...c.server, sessions: data.sessions}}));
      }
    } catch (err) {
      if (err.code === 'forbidden') setFatal(errText('forbidden'));
      else if (coreRef.current.server.version === null) setStatus('error');
    }
  }, [token]);

  useEffect(() => {
    refresh();
    const tick = () => { if (!document.hidden) refresh(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [refresh]);

  useEffect(() => {
    if (server.version !== null) store.set(KEY_STATE, JSON.stringify(server));
  }, [server]);

  // Keep the selected session in the URL so sharing it keeps the session.
  useEffect(() => {
    if (!currentId) return;
    const params = readHash();
    if (params.get('s') === currentId) return;
    params.set('s', currentId);
    history.replaceState(null, '', `#${params}`);
  }, [currentId]);

  useEffect(() => {
    const onHash = () => {
      const s = readHash().get('s');
      if (s) setSid(s);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const tab = tabsRef.current && tabsRef.current.querySelector('[aria-selected="true"]');
    if (tab && tab.scrollIntoView) tab.scrollIntoView({block: 'nearest', inline: 'center'});
  }, [currentId, sessions.length]);

  // ---- writes ----

  const send = (op) => (op.type === 'pick'
    ? api.pick(token, op.sid, op.member, op.boat, op.seat)
    : api.remove(token, op.sid, op.member, op.boat, op.seat));

  // Optimistic: show the change at once, roll back by dropping the op if the request fails.
  // Requests run one after another so a quick second tap can't overtake the first.
  const submit = (op) => {
    op.id = ++nextOpId;
    epoch.current++;
    update((c) => ({...c, ops: [...c.ops, op]}));
    const drop = (c) => c.ops.filter((o) => o.id !== op.id);
    queue.current = queue.current.then(async () => {
      try {
        await send(op);
        update((c) => ({
          // Keep the old version: the refresh below must see the server's version as new, or it would
          // skip rows a colleague wrote just before this write (version +2 looks "already known").
          server: {...c.server, signups: applyOp(c.server.signups, op)},
          ops: drop(c),
        }));
        epoch.current++;
        refresh();
      } catch (err) {
        update((c) => ({...c, ops: drop(c)}));
        epoch.current++;
        showToast(errText(err.code));
        if (err.code === 'forbidden') setFatal(errText('forbidden'));
        else if (err.code !== 'network') refresh();
      }
    });
  };

  useEffect(() => {
    if (!jump || jump.sid !== currentId) return undefined;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(jump.id);
      if (!el) return;
      el.scrollIntoView({behavior: 'smooth', block: 'center'});
      el.classList.remove('flash');
      void el.offsetWidth;   // restart the animation
      el.classList.add('flash');
    });
    return () => cancelAnimationFrame(raf);
  }, [jump, currentId]);

  // "My dates" panel: show the chosen boat, or give the choice up again.
  const showChoice = (s, row) => {
    selectSession(s.session_id);
    setJump({sid: s.session_id, id: anchorId(row.boat_id), n: Date.now()});
  };
  const unchoose = (s, row) => submit({type: 'remove', sid: s.session_id, member: me, boat: row.boat_id, seat: row.seat});

  const needName = () => {
    if (me) return false;
    showToast(STR.needName);
    if (nameRef.current) nameRef.current.focus();
    return true;
  };

  const writable = (bookable) => current && current.status === 'aktiv' && !current.locked && bookable;
  const mineRows = signups.filter((r) => r.session_id === currentId && me && sameName(r.member_id, me));

  // Tap a seat or a category: take it (replacing an earlier choice), or give it up again.
  const choose = (boatId, seat, bookable) => {
    if (!writable(bookable) || needName()) return;
    const holder = signups.find((r) => r.session_id === currentId && r.boat_id === boatId && r.seat === seat);
    if (seat !== null && holder && !sameName(holder.member_id, me)) {
      showToast(holder.member_id, 2500);
      return;
    }
    const op = {sid: currentId, member: me, boat: boatId, seat};
    const have = mineRows.some((r) => r.boat_id === boatId && r.seat === seat);
    submit({...op, type: have ? 'remove' : 'pick'});
  };

  // ---- derived view data ----

  const pendingSeats = {};  // `${sid}|${boat}` -> seats being written
  const busy = new Set();   // `${sid}|${boat}` with any write in flight
  ops.forEach((op) => {
    const key = `${op.sid}|${op.boat}`;
    busy.add(key);
    if (op.seat !== null) (pendingSeats[key] = pendingSeats[key] || []).push(op.seat);
  });

  const names = useMemo(() => {
    const seen = new Map();
    signups.forEach((r) => {
      const k = r.member_id.toLowerCase();
      if (!seen.has(k)) seen.set(k, r.member_id);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'));
  }, [signups]);

  const groups = useMemo(() => groupBoats(boats), [boats]);
  const inSession = signups.filter((r) => r.session_id === currentId);
  const mineBySession = me
    ? sessions.map((s) => ({
      s,
      rows: signups.filter((r) => r.session_id === s.session_id && sameName(r.member_id, me)),
    })).filter((x) => x.rows.length)
    : [];

  const selectSession = (id) => {
    setSid(id);
    setShowMine(false);
    scrollTo({top: 0});
  };

  const shareUrl = current
    ? `https://wa.me/?text=${encodeURIComponent(whatsappText(current, boats, signups, location.href.split('#')[0]))}`
    : '';

  const saveName = (e) => {
    const n = normName(e.target.value);
    setName(n);
    store.set(KEY_NAME, n);
  };

  // ---- render ----

  const choiceLabel = (r) => {
    const what = r.boat_id === UNSURE_ID
      ? STR.pool
      : isCat(r.boat_id)
      ? `${STR.anyBoat}: ${(groups.find((g) => `${CAT_PREFIX}${g.key}` === r.boat_id) || {label: r.boat_id}).label}`
      : `${(boats.find((b) => b.boat_id === r.boat_id) || {name: r.boat_id}).name}, ${STR.seatN(r.seat)}`;
    return what;
  };

  let body;
  if (status === 'loading') {
    body = html`<p class="info">${STR.loading}</p>`;
  } else if (status === 'error') {
    body = html`<div class="info"><p>${STR.offline}</p><button class="btn" onClick=${refresh}>${STR.retry}</button></div>`;
  } else if (!current) {
    body = html`<p class="info">${STR.noSessions}</p>`;
  } else if (current.status !== 'aktiv') {
    body = html`<p class="info">${STR.cancelled}</p>`;
  } else {
    body = html`${current.locked && html`<p class="banner">${STR.locked}</p>`}
      <${Pool} me=${me} rows=${inSession.filter((r) => r.boat_id === UNSURE_ID)}
        disabled=${!writable(true)} busy=${busy.has(`${currentId}|${UNSURE_ID}`)}
        onPick=${() => choose(UNSURE_ID, null, true)} />
      ${groups.map((g) => html`<${Group} key=${g.key} group=${g} me=${me}
        rows=${inSession.filter((r) => r.boat_id === `${CAT_PREFIX}${g.key}`)}
        seated=${inSession.filter((r) => r.seat !== null && g.boats.some((b) => b.bookable && b.boat_id === r.boat_id)).length
          + inSession.filter((r) => r.boat_id === `${CAT_PREFIX}${g.key}`).length}
        fill=${summaryCat(g, inSession).state}
        places=${g.boats.reduce((n, b) => n + (b.bookable ? b.seats + (b.cox ? 1 : 0) : 0), 0)}
        disabled=${!writable(g.boats.some((b) => b.bookable))}
        busy=${busy.has(`${currentId}|${CAT_PREFIX}${g.key}`)}
        reveal=${jump && jump.sid === currentId ? jump.n : 0}
        onPick=${() => choose(`${CAT_PREFIX}${g.key}`, null, true)}>
        ${g.boats.map((boat) => html`<${BoatCard} key=${boat.boat_id} boat=${boat} me=${me}
          rows=${inSession.filter((r) => r.boat_id === boat.boat_id)}
          locked=${current.locked}
          pendingSeats=${pendingSeats[`${currentId}|${boat.boat_id}`]}
          onSeat=${(seat) => choose(boat.boat_id, seat, boat.bookable)} />`)}
      </${Group}>`)}`;
  }

  return html`<div class="app">
    <header class="head">
      <label class="field">
        <span>${STR.nameLabel}</span>
        <input ref=${nameRef} type="text" value=${name} maxlength="40" list="names"
          autocomplete="off" autocapitalize="words" enterkeyhint="done"
          onInput=${(e) => setName(e.target.value)} onBlur=${saveName}
          onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />
      </label>
      <datalist id="names">${names.map((n) => html`<option key=${n} value=${n} />`)}</datalist>
      <div class="tabs" role="tablist" aria-label=${STR.sessions} ref=${tabsRef}>
        ${sessions.map((s) => html`<button key=${s.session_id} role="tab" type="button"
          class=${`tab${s.status !== 'aktiv' ? ' cancelled' : ''}`}
          aria-selected=${s.session_id === currentId ? 'true' : 'false'}
          onClick=${() => selectSession(s.session_id)}>${sessionLabel(s)}</button>`)}
      </div>
    </header>
    <main class="main">
      ${fatal && html`<p class="banner error" role="alert">${fatal}</p>`}
      <${Weather} session=${current} />
      ${status === 'ok' && current && current.status === 'aktiv' && html`<${Summary} total=${inSession.length}
        cats=${groups.map((g) => summaryCat(g, inSession))} />`}
      ${body}
    </main>
    <footer class="bar">
      ${toast && html`<div class="toast" role="status">${toast}</div>`}
      ${showMine && html`<section class="mine" aria-label=${STR.myDates}>
        ${mineBySession.length
          ? mineBySession.map(({s, rows}) => html`<div key=${s.session_id} class="mine-item">
              <button class="mine-session" type="button" onClick=${() => selectSession(s.session_id)}>
                <strong>${sessionLabel(s)}</strong>
              </button>
              ${rows.map((r) => html`<div key=${`${r.boat_id}|${r.seat}`} class="mine-row">
                <button class="mine-go" type="button" title=${STR.showBoat} onClick=${() => showChoice(s, r)}>
                  ${choiceLabel(r)}
                </button>
                <button class="mine-remove" type="button" aria-label=${STR.unselect} title=${STR.unselect}
                  disabled=${s.locked || s.status !== 'aktiv'} onClick=${() => unchoose(s, r)}>×</button>
              </div>`)}
            </div>`)
          : html`<p class="muted">${STR.noneMine}</p>`}
      </section>`}
      <div class="bar-row">
        <button class="btn" type="button" aria-expanded=${showMine ? 'true' : 'false'}
          onClick=${() => setShowMine(!showMine)}>
          ${STR.myDates}${mineBySession.length ? ` (${mineBySession.length})` : ''}
        </button>
        <a class="btn primary" href=${shareUrl || undefined} aria-disabled=${shareUrl ? undefined : 'true'}
          target="_blank" rel="noopener">${STR.share}</a>
      </div>
    </footer>
  </div>`;
}

// DOM id for scrolling to a boat card or a boat class.
const anchorId = (boatId) => `pick-${String(boatId).replace(/[^\w-]+/g, '_')}`;

// Fill state of a boat class: 'full' (all places taken), 'open' (some boat is partly filled), else 'none'.
// People who chose "Egal welches Boot" count as participants of the class but don't occupy a seat yet.
function summaryCat(g, rows) {
  const any = rows.filter((r) => r.boat_id === `${CAT_PREFIX}${g.key}`).length;
  let people = any;
  let partial = false;
  let places = 0;
  g.boats.filter((b) => b.bookable).forEach((b) => {
    const n = rows.filter((r) => r.boat_id === b.boat_id && r.seat !== null).length;
    const cap = b.seats + (b.cox ? 1 : 0);
    people += n;
    places += cap;
    if (n > 0 && n < cap) partial = true;
  });
  const state = !people ? 'none' : people >= places ? 'full' : partial ? 'open' : 'none';
  return {key: g.key, label: g.label, klasse: g.klasse, people, state};
}

function Summary({total, cats}) {
  return html`<section class="sum" aria-label=${STR.summary}>
    <span class="sum-total"><strong>${total}</strong> ${STR.participants}</span>
    <span class="sum-cats">${cats.map((c) => html`<span key=${c.key} class=${`sum-cat ${c.state}`}
      title=${`${c.label}: ${c.people}`}>${c.klasse}</span>`)}</span>
  </section>`;
}

function Dot({name, me}) {
  const mine = me !== '' && sameName(name, me);
  return html`<span class=${`dot${mine ? ' mine' : ''}`} title=${name}>${initials(name)}</span>`;
}

// "Noch ohne Wahl": tap to say you don't know yet which boat; shows everyone who did.
function Pool({me, rows, disabled, busy, onPick}) {
  const mine = me ? rows.find((r) => sameName(r.member_id, me)) : null;
  return html`<section class="pool" aria-label=${STR.pool}>
    <button type="button" class="any" aria-pressed=${mine ? 'true' : 'false'}
      disabled=${disabled || busy} onClick=${onPick}>
      <span class="what">${STR.pool}</span>
      <span class="dots">${rows.length
        ? rows.map((r) => html`<${Dot} key=${r.member_id} name=${r.member_id} me=${me} />`)
        : html`<span class="dot empty" aria-hidden="true"></span>`}</span>
      <span class="counter">[${rows.length}]</span>
    </button>
  </section>`;
}

function Group({group, me, rows, seated, places, fill, disabled, busy, reveal, onPick, children}) {
  const [open, setOpen] = useState(true);
  useEffect(() => { if (reveal) setOpen(true); }, [reveal]);
  return html`<section id=${anchorId(`${CAT_PREFIX}${group.key}`)} class=${`group${open ? '' : ' collapsed'}`}>
    <button type="button" class="group-toggle" aria-expanded=${open ? 'true' : 'false'}
      onClick=${() => setOpen(!open)}>
      <h2 class="group-title">${group.label}</h2>
      <span class=${`counter ${fill}`}>[${seated}/${places}]</span>
      <span class="chevron" aria-hidden="true"></span>
    </button>
    ${open && html`<${GroupHead} group=${group} me=${me} rows=${rows} disabled=${disabled} busy=${busy} onPick=${onPick} />`}
    ${open && children}
  </section>`;
}

function GroupHead({group, me, rows, disabled, busy, onPick}) {
  const mine = me ? rows.find((r) => sameName(r.member_id, me)) : null;
  return html`<div class="group-head">
    <button type="button" class="any" aria-pressed=${mine ? 'true' : 'false'}
      disabled=${disabled || busy} onClick=${onPick}>
      <span class="what">${STR.anyBoat}</span>
      <span class="dots">${rows.length
        ? rows.map((r) => html`<${Dot} key=${r.member_id} name=${r.member_id} me=${me} />`)
        : html`<span class="dot empty" aria-hidden="true"></span>`}</span>
    </button>
  </div>`;
}

function BoatCard({boat, me, rows, locked, pendingSeats, onSeat}) {
  const mine = me !== '' && rows.some((r) => sameName(r.member_id, me));
  const seated = rows.filter((r) => r.seat !== null);
  const places = boat.seats + (boat.cox ? 1 : 0);
  const off = !boat.bookable;
  const frozen = locked || off;
  return html`<article id=${anchorId(boat.boat_id)} class=${`card${off ? ' off' : ''}${mine ? ' has-mine' : ''}`}>
    <div class="card-head">
      <h2>${boat.name}</h2>
      <span class="badge">${boat.klasse}</span>
      <span class=${`counter${seated.length >= places ? ' full' : ''}`}
        title=${seated.length >= places ? STR.full : ''}>[${seated.length}/${places}]</span>
      ${seated.length >= places && html`<span class="badge full">${STR.fullShort}</span>`}
      ${off && html`<span class="badge warn">${STR.notBookable}</span>`}
      ${mine && html`<span class="badge mine">${STR.you}</span>`}
    </div>
    ${boat.notes && html`<p class="muted notes">${boat.notes}</p>`}
    <${BoatDiagram} boat=${boat} signups=${seated} me=${me} disabled=${frozen}
      pendingSeat=${pendingSeats} onSeat=${onSeat} />
    ${seated.length > 0 && html`<p class="line"><strong>${STR.inBoat}:</strong> ${seatList(seated).join(', ')}</p>`}
  </article>`;
}

render(html`<${App} />`, document.getElementById('app'));
