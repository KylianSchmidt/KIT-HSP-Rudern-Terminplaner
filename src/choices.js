// Choice model shared by the app and the mock backend.
// A member has one row per session. A row is either a seat in a boat ({boat_id, seat}) or a whole boat category ({boat_id: 'cat:<key>', seat: null}).
import {sameName} from './format.js';

export const CAT_PREFIX = 'cat:';
export const isCat = (boatId) => String(boatId).startsWith(CAT_PREFIX);

// Gig boats first, then bigger racing boats before smaller ones.
export function groupBoats(boats) {
  const map = new Map();
  boats.forEach((b) => {
    const key = `${b.typ}|${b.klasse}`;
    if (!map.has(key)) map.set(key, {key, typ: b.typ, klasse: b.klasse, seats: b.seats, label: `${b.typ} ${b.klasse}`, boats: []});
    map.get(key).boats.push(b);
  });
  const typRank = (g) => (/gig/i.test(g.typ) ? 0 : 1);
  const groups = [...map.values()].sort((a, b) => typRank(a) - typRank(b) || b.seats - a.seats || a.klasse.localeCompare(b.klasse));
  groups.forEach((g) => g.boats.sort((a, b) => (!a.bookable) - (!b.bookable)));
  return groups;
}

// op: {type: 'pick' | 'remove', sid, member, boat, seat (string, or null for a category)}
// One choice per member and session: picking something new replaces the old choice.
export function applyOp(signups, op) {
  const mine = (r) => r.session_id === op.sid && sameName(r.member_id, op.member);
  const seat = op.seat === undefined || op.seat === null ? null : String(op.seat);
  if (op.type === 'remove') return signups.filter((r) => !(mine(r) && r.boat_id === op.boat && r.seat === seat));
  return signups.filter((r) => !mine(r)).concat({session_id: op.sid, member_id: op.member, boat_id: op.boat, seat});
}
