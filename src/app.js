// Root component: state, routing by hash, optimistic writes, polling.
import {html, render, useCallback, useEffect, useMemo, useRef, useState} from './vendor/standalone.module.js';
import {MODE} from './config.js';
import * as api from './api.js';
import {
  STR, errText, normName, sameName, sessionLabel, seatList, wishList, whatsappText,
} from './format.js';
import {BoatDiagram} from './boat.js';

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

// Mirrors the backend rules so optimistic updates match what the sheet will contain.
function applyOp(signups, op) {
  const mine = (r) => r.session_id === op.sid && sameName(r.member_id, op.member);
  const row = {session_id: op.sid, member_id: op.member, boat_id: op.boat, seat: null, rank: null};
  if (op.type === 'remove') {
    return signups.filter((r) => !(mine(r) && r.boat_id === op.boat));
  }
  if (op.type === 'seat') {
    // One seat per member per session; wishes stay.
    return signups.filter((r) => !(mine(r) && r.seat !== null)).concat({...row, seat: op.seat});
  }
  // One wish per boat, one boat per rank.
  return signups
    .filter((r) => !(mine(r) && r.seat === null && (r.boat_id === op.boat || r.rank === op.rank)))
    .concat({...row, rank: op.rank});
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

  const send = (op) => {
    if (op.type === 'seat') return api.setSeat(token, op.sid, op.member, op.boat, op.seat);
    if (op.type === 'rank') return api.setRank(token, op.sid, op.member, op.boat, op.rank);
    return api.remove(token, op.sid, op.member, op.boat);
  };

  // Optimistic: show the change at once, roll back by dropping the op if the request fails.
  // Requests run one after another so a quick second tap can't overtake the first.
  const submit = (op) => {
    op.id = ++nextOpId;
    epoch.current++;
    update((c) => ({...c, ops: [...c.ops, op]}));
    const drop = (c) => c.ops.filter((o) => o.id !== op.id);
    queue.current = queue.current.then(async () => {
      try {
        const res = await send(op);
        update((c) => ({
          server: {...c.server, signups: applyOp(c.server.signups, op), version: res.version === undefined ? c.server.version : String(res.version)},
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

  const needName = () => {
    if (me) return false;
    showToast(STR.needName);
    if (nameRef.current) nameRef.current.focus();
    return true;
  };

  const writable = (boat) => current && current.status === 'aktiv' && !current.locked && boat.bookable;

  const onSeat = (boat, seat) => {
    if (!writable(boat) || needName()) return;
    const holder = signups.find((r) => r.session_id === currentId && r.boat_id === boat.boat_id && r.seat === seat);
    if (holder && !sameName(holder.member_id, me)) {
      showToast(holder.member_id, 2500);
      return;
    }
    const op = {sid: currentId, member: me, boat: boat.boat_id, seat};
    submit(holder ? {...op, type: 'remove'} : {...op, type: 'seat'});
  };

  const onRank = (boat, rank) => {
    if (!writable(boat) || needName()) return;
    const op = {sid: currentId, member: me, boat: boat.boat_id};
    const mineSeat = signups.find((r) => r.session_id === currentId && r.boat_id === boat.boat_id
      && r.seat !== null && sameName(r.member_id, me));
    const myRank = signups.find((r) => r.session_id === currentId && r.boat_id === boat.boat_id
      && r.seat === null && sameName(r.member_id, me));
    if (myRank && myRank.rank === rank) {
      submit({...op, type: 'remove', seat: mineSeat && mineSeat.seat});
    } else {
      submit({...op, type: 'rank', rank});
    }
  };

  // ---- derived view data ----

  const pendingSeats = {};  // `${sid}|${boat}` -> seats being written
  const busy = new Set();   // `${sid}|${boat}` with any write in flight
  ops.forEach((op) => {
    const key = `${op.sid}|${op.boat}`;
    busy.add(key);
    if (op.seat) (pendingSeats[key] = pendingSeats[key] || []).push(op.seat);
  });

  const names = useMemo(() => {
    const seen = new Map();
    signups.forEach((r) => {
      const k = r.member_id.toLowerCase();
      if (!seen.has(k)) seen.set(k, r.member_id);
    });
    return [...seen.values()].sort((a, b) => a.localeCompare(b, 'de'));
  }, [signups]);

  const sortedBoats = [...boats].sort((a, b) => (!a.bookable) - (!b.bookable));
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

  const boatName = (id) => (boats.find((b) => b.boat_id === id) || {name: id}).name;

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
      ${sortedBoats.map((boat) => html`<${BoatCard} key=${boat.boat_id} boat=${boat} me=${me}
        rows=${signups.filter((r) => r.session_id === currentId && r.boat_id === boat.boat_id)}
        locked=${current.locked}
        pendingSeats=${pendingSeats[`${currentId}|${boat.boat_id}`]}
        busy=${busy.has(`${currentId}|${boat.boat_id}`)}
        onSeat=${(seat) => onSeat(boat, seat)} onRank=${(rank) => onRank(boat, rank)} />`)}`;
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
      ${body}
    </main>
    <footer class="bar">
      ${toast && html`<div class="toast" role="status">${toast}</div>`}
      ${showMine && html`<section class="mine" aria-label=${STR.myDates}>
        ${mineBySession.length
          ? mineBySession.map(({s, rows}) => html`<button key=${s.session_id} class="mine-item" type="button"
              onClick=${() => selectSession(s.session_id)}>
              <strong>${sessionLabel(s)}</strong>
              <span>${rows.map((r) => `${boatName(r.boat_id)}: ${r.seat !== null ? STR.seatN(r.seat) : STR.myRank(r.rank)}`).join(' · ')}</span>
            </button>`)
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

function BoatCard({boat, me, rows, locked, pendingSeats, busy, onSeat, onRank}) {
  const seated = rows.filter((r) => r.seat !== null);
  const wished = rows.filter((r) => r.seat === null && r.rank !== null);
  const others = wished.filter((r) => !sameName(r.member_id, me));
  const mine = me ? wished.find((r) => sameName(r.member_id, me)) : null;
  const off = !boat.bookable;
  const frozen = locked || off;
  return html`<article class=${`card${off ? ' off' : ''}`}>
    <div class="card-head">
      <h2>${boat.name}</h2>
      <span class="badge">${boat.klasse}</span>
      ${boat.typ && html`<span class="muted">${boat.typ}</span>`}
      ${off && html`<span class="badge warn">${STR.notBookable}</span>`}
    </div>
    ${boat.notes && html`<p class="muted notes">${boat.notes}</p>`}
    ${MODE !== 'ranks' && html`<${BoatDiagram} boat=${boat} signups=${seated} me=${me}
      disabled=${frozen || MODE === 'ranks'} pendingSeat=${pendingSeats} onSeat=${onSeat} />`}
    ${MODE !== 'seats' && html`<div class="ranks" role="group" aria-label=${STR.prio}>
      <span class="muted">${STR.prio}</span>
      ${[1, 2, 3].map((n) => html`<button key=${n} type="button" class="rank"
        aria-pressed=${mine && mine.rank === n ? 'true' : 'false'} aria-label=${STR.prioLabel(n)}
        disabled=${frozen || busy} onClick=${() => onRank(n)}>${n}</button>`)}
    </div>`}
    <p class="line">${seated.length
      ? html`<strong>${STR.inBoat}:</strong> ${seatList(seated).join(', ')}`
      : !off && !others.length && html`<span class="muted">${STR.nobody}</span>`}</p>
    ${others.length > 0 && html`<p class="line"><strong>${STR.wishes}:</strong> ${wishList(others).join(', ')}</p>`}
  </article>`;
}

render(html`<${App} />`, document.getElementById('app'));
