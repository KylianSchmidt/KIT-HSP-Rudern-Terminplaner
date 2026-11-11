// Inline-SVG boat diagram, drawn from the boat data only. All geometry lives in the constants below.
// Units are CSS px (1 SVG unit = 1 CSS px), so every slot is a real SLOT x SLOT tap target.
import {html} from './vendor/standalone.module.js';
import {STR, initials, sameName} from './format.js';

const SLOT = 48;          // slot size along and across the boat (>= 48 for touch)
const HULL_RACE = 34;     // very slim racing shell
const HULL_GIG = 34;      // gig boat: as narrow as the racing shell
const PAD_BOW = 19;       // room in front of the hull for the bow ball and the direction arrow
const PAD_STERN = 2;
const OAR_LEN = 24;       // oar length beyond the hull edge (across the boat)
const OAR_SWEEP = 12;     // oars are angled this far towards the stern
const OAR_BLADE = 10;     // thicker blade part at the end of an oar
const RIG_STROKE_SIDE = 1; // sweep rig: side of the stroke seat's oar; 1 = lower/right edge, -1 = upper/left

// Hull border colour by the sheet's `Farbe` value.
const HULL_COLORS = {
  Lila: '#8e44ad', Gruen: '#2e9e4f', Blau: '#2f6fd0', Gelb: '#f1c40f',
  Weiss: '#ffffff', Rot: '#d32f2f', Braun: '#8d5a2b',
};

function slotsOf(boat) {
  const slots = [];
  for (let i = 1; i <= boat.seats; i++) slots.push(String(i));
  if (boat.cox) slots.push('St');
  return slots;
}

// Sides (-1 / 1) on which seat index i (0 = bow) has an oar.
function oarSides(boat, i) {
  if (i >= boat.seats) return [];   // the cox has no oars
  const klasse = String(boat.klasse || '').toLowerCase();
  if (klasse.includes('x')) return [-1, 1];
  if (klasse.includes('-') || klasse.includes('+')) {
    return [(boat.seats - 1 - i) % 2 === 0 ? RIG_STROKE_SIDE : -RIG_STROKE_SIDE];
  }
  return [];
}

export function BoatDiagram({boat, signups, me, disabled, pendingSeat, onSeat}) {
  // Always horizontal; the SVG scales down via CSS (max-width: 100%) when the card is narrower than the boat.
  const horizontal = true;
  const slots = slotsOf(boat);
  const gig = /gig/i.test(boat.typ);
  const HULL_W = gig ? HULL_GIG : HULL_RACE;
  const SEAT_R = Math.min(19, HULL_W / 2 - 3);
  const BOW = gig ? 50 : 66;        // both hulls taper to a point; the gig has shorter ends
  const STERN = BOW;                // stern looks the same as the bow
  const length = BOW + slots.length * SLOT + STERN;
  const total = PAD_BOW + length + PAD_STERN;
  const across = HULL_W + 2 * OAR_LEN;
  const mid = across / 2;
  const top = OAR_LEN;
  const bottom = OAR_LEN + HULL_W;

  // (a, c) = (along the boat from the bow, across the boat) -> svg coordinates
  const p = (a, c) => (horizontal ? `${a} ${c}` : `${c} ${a}`);
  const x = (a, c) => (horizontal ? a : c);
  const y = (a, c) => (horizontal ? c : a);

  // Both hull types: straight middle, convex taper to a sharp point at bow and stern.
  const edgeBow = (edge) => `C${p(BOW * 0.3, mid + (edge - mid) * 0.6)} ${p(BOW * 0.65, edge)} ${p(BOW, edge)}`;
  const hull = [
    `M${p(0, mid)}`,
    edgeBow(top),
    `L${p(length - STERN, top)}`,
    `C${p(length - STERN * 0.65, top)} ${p(length - STERN * 0.3, mid - (mid - top) * 0.6)} ${p(length, mid)}`,
    `C${p(length - STERN * 0.3, mid + (bottom - mid) * 0.6)} ${p(length - STERN * 0.65, bottom)} ${p(length - STERN, bottom)}`,
    `L${p(BOW, bottom)}`,
    `C${p(BOW * 0.65, bottom)} ${p(BOW * 0.3, mid + (bottom - mid) * 0.6)} ${p(0, mid)}`,
    'Z',
  ].join('');

  const pending = [].concat(pendingSeat === undefined || pendingSeat === null ? [] : pendingSeat);
  const by = new Map(signups.map((r) => [String(r.seat), r]));

  const oars = [];
  const seatNodes = slots.map((seat, i) => {
    const a = BOW + SLOT * (i + 0.5);
    oarSides(boat, i).forEach((side) => {
      const c1 = mid + side * (HULL_W / 2 - 2);
      const c2 = mid + side * (HULL_W / 2 + OAR_LEN);
      const t = 1 - OAR_BLADE / (OAR_LEN + 2);             // where the blade starts along the oar
      const cb = c1 + (c2 - c1) * t;
      const a2 = a + OAR_SWEEP;                            // the tip points against the direction of travel
      const ab = a + OAR_SWEEP * t;
      oars.push(html`<g key=${`o${seat}${side}`}>
        <line class="oar" x1=${x(a, c1)} y1=${y(a, c1)} x2=${x(a2, c2)} y2=${y(a2, c2)} />
        <line class="blade" x1=${x(ab, cb)} y1=${y(ab, cb)} x2=${x(a2, c2)} y2=${y(a2, c2)} />
      </g>`);
    });

    const row = by.get(seat);
    const who = row && row.member_id;
    const taken = row !== undefined;
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
        ? html`<text class="who" x=${cx} y=${cy}>${initials(who)}</text>`
        : html`<text class="who" x=${cx} y=${cy}>${seat}</text>`}
    </g>`;
  });

  const w = horizontal ? total : across;
  const h = horizontal ? across : total;
  const shift = horizontal ? `${PAD_BOW} 0` : `0 ${PAD_BOW}`;
  return html`<svg class=${`boat${disabled ? ' disabled' : ''}`} width=${w} height=${h}
    viewBox=${`0 0 ${w} ${h}`} role="group" aria-label=${STR.boatDiagram(boat.name)}>
    <g transform=${`translate(${shift})`}>
      ${oars}
      <path class=${`hull${HULL_COLORS[boat.color] ? ' colored' : ''}`} d=${hull}
        style=${HULL_COLORS[boat.color] ? `stroke:${HULL_COLORS[boat.color]};fill:color-mix(in srgb, ${HULL_COLORS[boat.color]} 22%, var(--hull))` : undefined} />
      <circle class="ball" cx=${x(-1, mid)} cy=${y(-1, mid)} r="4.5" />
      <polygon class="arrow" points=${`${p(-17, mid)} ${p(-9, mid - 5)} ${p(-9, mid + 5)}`} />
      ${seatNodes}
    </g>
  </svg>`;
}
