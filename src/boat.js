// Inline-SVG boat diagram, drawn from the boat data only. All geometry lives in the constants below.
// Units are CSS px (1 SVG unit = 1 CSS px), so every slot is a real SLOT x SLOT tap target.
import {html, useLayoutEffect, useRef, useState} from './vendor/standalone.module.js';
import {STR, initials, sameName} from './format.js';

const SLOT = 48;          // slot size along and across the boat (>= 48 for touch)
const BOW = 36;           // pointed bow section in front of seat 1
const STERN = 12;         // rounded stern section behind the last slot
const HULL_W = SLOT;      // hull width
const OAR_LEN = 14;       // oar stub length beyond the hull edge
const OAR_BLADE = 9;      // thicker blade part at the end of an oar
const SEAT_R = 19;        // radius of the drawn seat circle
const RIG_STROKE_SIDE = 1; // sweep rig: side of the stroke seat's oar; 1 = lower/right edge, -1 = upper/left

function slotsOf(boat) {
  const slots = [];
  for (let i = 1; i <= boat.seats; i++) slots.push(String(i));
  if (boat.cox) slots.push('St');
  return slots;
}

// Sides (-1 / 1) on which seat index i (0 = bow) has an oar.
function oarSides(boat, i) {
  const klasse = String(boat.klasse || '').toLowerCase();
  if (klasse.includes('x')) return [-1, 1];
  if (klasse.includes('-') || klasse.includes('+')) {
    return [(boat.seats - 1 - i) % 2 === 0 ? RIG_STROKE_SIDE : -RIG_STROKE_SIDE];
  }
  return [];
}

export function BoatDiagram({boat, signups, me, disabled, pendingSeat, onSeat}) {
  const ref = useRef(null);
  const [horizontal, setHorizontal] = useState(true);
  const slots = slotsOf(boat);
  const length = BOW + slots.length * SLOT + STERN;
  const across = HULL_W + 2 * OAR_LEN;
  const mid = across / 2;
  const top = OAR_LEN;
  const bottom = OAR_LEN + HULL_W;

  // Horizontal when the card is wide enough for the whole boat, else vertical (bow at the top).
  useLayoutEffect(() => {
    const card = ref.current && ref.current.parentElement;
    if (!card) return undefined;
    const fit = (w) => setHorizontal(w >= length);
    const cs = getComputedStyle(card);
    fit(card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => fit(entries[0].contentRect.width));
    ro.observe(card);
    return () => ro.disconnect();
  }, [length]);

  // (a, c) = (along the boat from the bow, across the boat) -> svg coordinates
  const p = (a, c) => (horizontal ? `${a} ${c}` : `${c} ${a}`);
  const x = (a, c) => (horizontal ? a : c);
  const y = (a, c) => (horizontal ? c : a);

  const hull = [
    `M${p(0, mid)}`,
    `C${p(BOW * 0.45, mid - HULL_W * 0.15)} ${p(BOW * 0.6, top)} ${p(BOW, top)}`,
    `L${p(length - STERN, top)}`,
    `Q${p(length, top)} ${p(length, top + 8)}`,
    `L${p(length, bottom - 8)}`,
    `Q${p(length, bottom)} ${p(length - STERN, bottom)}`,
    `L${p(BOW, bottom)}`,
    `C${p(BOW * 0.6, bottom)} ${p(BOW * 0.45, mid + HULL_W * 0.15)} ${p(0, mid)}Z`,
  ].join('');

  const pending = [].concat(pendingSeat === undefined || pendingSeat === null ? [] : pendingSeat);
  const by = new Map(signups.map((r) => [String(r.seat), r.member_id]));

  const oars = [];
  const seatNodes = slots.map((seat, i) => {
    const a = BOW + SLOT * (i + 0.5);
    oarSides(boat, i).forEach((side) => {
      const c1 = mid + side * (HULL_W / 2 - 2);
      const c2 = mid + side * (HULL_W / 2 + OAR_LEN);
      const cb = c2 - side * OAR_BLADE;
      oars.push(html`<g key=${`o${seat}${side}`}>
        <line class="oar" x1=${x(a, c1)} y1=${y(a, c1)} x2=${x(a, c2)} y2=${y(a, c2)} />
        <line class="blade" x1=${x(a, cb)} y1=${y(a, cb)} x2=${x(a, c2)} y2=${y(a, c2)} />
      </g>`);
    });

    const who = by.get(seat);
    const taken = who !== undefined;
    const mine = taken && me !== '' && sameName(who, me);
    const isPending = pending.includes(seat);
    const tappable = !disabled && !isPending;
    const cx = x(a, mid);
    const cy = y(a, mid);
    const state = mine ? 'mine' : taken ? 'taken' : 'free';
    const label = `${STR.seatN(seat)}, ${taken ? who : STR.free}`;
    const activate = () => tappable && onSeat(seat);

    return html`<g key=${seat}
      class=${`seat ${state}${isPending ? ' pending' : ''}${tappable ? ' tappable' : ''}`}
      role="button" tabindex=${disabled ? undefined : '0'} aria-label=${label}
      aria-disabled=${tappable ? undefined : 'true'}
      onClick=${activate}
      onKeyDown=${(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}>
      <title>${taken ? who : label}</title>
      <rect class="hit" x=${cx - SLOT / 2} y=${cy - SLOT / 2} width=${SLOT} height=${SLOT} />
      <circle class="disc" cx=${cx} cy=${cy} r=${SEAT_R} />
      ${taken
        ? html`<text class="who" x=${cx} y=${cy - 3}>${initials(who)}</text>
            <text class="num" x=${cx} y=${cy + 10}>${seat}</text>`
        : html`<text class="who" x=${cx} y=${cy}>${seat}</text>`}
    </g>`;
  });

  const w = horizontal ? length : across;
  const h = horizontal ? across : length;
  return html`<svg ref=${ref} class=${`boat${disabled ? ' disabled' : ''}`} width=${w} height=${h}
    viewBox=${`0 0 ${w} ${h}`} role="group" aria-label=${STR.boatDiagram(boat.name)}>
    ${oars}
    <path class="hull" d=${hull} />
    ${seatNodes}
  </svg>`;
}
