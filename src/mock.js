// In-memory backend for design previews: open the page with #mock.
import {applyOp} from './choices.js';

const boat = (boat_id, name, klasse, typ, seats, cox, bookable = true, notes = '', color = '') =>
  ({boat_id, name, klasse, typ, seats, cox, bookable, notes, color});

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sessions = [];
for (let i = 1; sessions.length < 6; i++) {
  const d = new Date();
  d.setDate(d.getDate() + i);
  if ([2, 4, 6].includes(d.getDay())) {
    sessions.push({session_id: `s${sessions.length + 1}`, date: iso(d), start: d.getDay() === 6 ? '10:00' : '18:00', end: d.getDay() === 6 ? '12:00' : '20:00',
      status: sessions.length === 3 ? 'abgesagt' : 'aktiv', locked: false});
  }
}

const state = {
  version: 1,
  boats: [
    boat('z1', 'Zack', '1x', 'Rennboot', 1, false, true, '', 'Rot'),
    boat('b4', 'Blitz', '4x', 'Rennboot', 4, false, true, '', 'Blau'),
    boat('w2', 'Wiking', '2-', 'Rennboot', 2, false, true, '', 'Gelb'),
    boat('h4', 'Hansa', '4x+', 'Gigboot', 4, true, true, 'Steuer klemmt leicht', 'Gruen'),
    boat('m2', 'Möwe', '2x', 'Rennboot', 2, false, true, '', 'Braun'),
    boat('p4', 'Pfeil', '4x', 'Rennboot', 4, false),
    boat('e4', 'Elbe', '4x+', 'Gigboot', 4, true, true, '', 'Lila'),
    boat('f1', 'Flink', '1x', 'Rennboot', 1, false, false),
    boat('g2', 'Gustav', '2x', 'Gigboot', 2, false, true, '', 'Weiss'),
  ],
  sessions,
  signups: [],
};
const sid = 's1';
const add = (member, boat_id, seat) => state.signups.push({session_id: sid, member_id: member, boat_id, seat});
add('Anna Weber', 'h4', '2');
add('Ben Koch', 'h4', '3');
add('Carla Lang', 'b4', '1');
add('Dennis Roth', 'b4', '4');
add('Eva Brandt', 'cat:Rennboot|4x', null);
add('Farid Nazari', 'z1', '1');
add('Gina Fuchs', 'm2', '2');
['Hanna Vogel', 'Ivo Berger', 'Jonas Krug', 'Klara Stein', 'Lukas Moll', 'Mia Sommer', 'Nils Adler', 'Olga Wirth', 'Paul Dorn'].forEach((n) => add(n, 'cat:Rennboot|4x', null));
['Quirin Ernst', 'Rosa Lenz', 'Sven Maier', 'Tina Baum', 'Udo Haas'].forEach((n, i) => add(n, 'e4', i < 4 ? String(i + 1) : 'St'));

const wait = () => new Promise((r) => setTimeout(r, 150));
const snapshot = () => ({ok: true, ...JSON.parse(JSON.stringify(state)), version: String(state.version)});

export async function getState() {
  await wait();
  return snapshot();
}

export async function write(op) {
  await wait();
  state.signups = applyOp(state.signups, op);
  state.version++;
  return {ok: true, version: state.version};
}
