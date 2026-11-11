// Weather for the time slot of the selected training, from Open-Meteo
// (free, no key, CORS enabled; DWD ICON model; hourly forecast up to 16 days ahead).
import {html, useEffect, useState} from './vendor/standalone.module.js';
import {WEATHER} from './config.js';

const REFRESH_MS = 5 * 60 * 1000;
const HOURLY = 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,wind_direction_10m';
const URL = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
  latitude: WEATHER.lat,
  longitude: WEATHER.lon,
  hourly: HOURLY,
  past_days: 1,
  forecast_days: 16,
  wind_speed_unit: 'kmh',
  timezone: 'Europe/Berlin',
});
const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const dir = (deg) => DIRS[Math.round(deg / 45) % 8];
const num = (v, d = 0) => Number(v).toFixed(d).replace('.', ',');
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function useForecast() {
  const [state, setState] = useState({data: null, error: false});
  useEffect(() => {
    let alive = true;
    const load = () => fetch(URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((data) => alive && setState({data, error: false}))
      .catch(() => alive && setState((s) => ({...s, error: true})));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return state;
}

// Hourly rows that overlap the session (end defaults to start + 90 min).
function slotRows(h, session) {
  const date = String(session.date).slice(0, 10);
  const from = minutes(session.start);
  const to = session.end ? minutes(session.end) : from + 90;
  const rows = [];
  h.time.forEach((t, i) => {
    if (t.slice(0, 10) !== date) return;
    const m = minutes(t.slice(11));
    if (m + 60 <= from || m >= to) return;
    rows.push({
      temp: h.temperature_2m[i], rain: h.precipitation[i], prob: h.precipitation_probability[i],
      wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i], deg: h.wind_direction_10m[i],
    });
  });
  return rows;
}

const range = (xs, d = 0) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return num(lo, d) === num(hi, d) ? num(lo, d) : `${num(lo, d)}–${num(hi, d)}`;
};

function Tile({label, value, unit, sub}) {
  return html`<div class="wx-tile">
    <span class="wx-label">${label}</span>
    <strong>${value}<small>${unit}</small></strong>
    <span class="wx-sub">${sub}</span>
  </div>`;
}

export function Weather({session}) {
  const {data, error} = useForecast();
  if (!session || session.status !== 'aktiv') return null;
  const rows = data ? slotRows(data.hourly, session) : [];
  let body;
  if (rows.length) {
    const sum = rows.reduce((a, r) => a + r.rain, 0);
    const prob = Math.max(...rows.map((r) => r.prob ?? 0));
    const gust = Math.max(...rows.map((r) => r.gust));
    const sin = rows.reduce((a, r) => a + Math.sin(r.deg * Math.PI / 180), 0);
    const cos = rows.reduce((a, r) => a + Math.cos(r.deg * Math.PI / 180), 0);
    const deg = (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360;
    body = html`<div class="wx-grid">
      <${Tile} label="Temperatur" value=${range(rows.map((r) => r.temp))} unit=" °C" sub=${`${session.start}${session.end ? `–${session.end}` : ''} Uhr`} />
      <${Tile} label="Regen" value=${num(sum, 1)} unit=" mm" sub=${`Wahrsch. bis ${num(prob)} %`} />
      <${Tile} label="Wind" value=${range(rows.map((r) => r.wind))} unit=" km/h" sub=${`${dir(deg)}, Böen ${num(gust)}`} />
    </div>`;
  } else {
    body = html`<p class="wx-none">${data ? 'Für diesen Termin gibt es noch keine Prognose.' : error ? 'Wetter nicht verfügbar.' : 'Lade …'}</p>`;
  }
  return html`<section class="wx" aria-label="Wetter">
    <span class="wx-title">Wetter</span>
    ${body}
  </section>`;
}
