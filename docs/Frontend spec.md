# Frontend spec

Everything an implementing agent needs to build the member-facing page against the existing backend. The backend is deployed and must not be changed; this tab is the contract.

## Context and constraints

A rowing team trains on calendar events marked `@anmeldung`. Members open one link (from WhatsApp or the event), type their name, and pick a seat in a boat for an upcoming session. A Google Apps Script web app (see the Backend setup tab) stores everything in a Google Sheet.

Hard constraints:

- **Static site on GitHub Pages.** No server, no build step, no npm install needed to deploy. Plain ES modules loaded by the browser.
- **Framework:** Preact + hooks + htm from one vendored file, `vendor/standalone.module.js`, copied from `https://unpkg.com/htm@3/preact/standalone.module.js`. No CDN at runtime.
- **Mobile first:** most use is on phones (360 px wide and up). Tap targets at least 44 px. Works in current Safari, Chrome and Firefox.
- **Fast:** under 50 kB total excluding the vendor file, no web fonts, no images except an OG preview image.
- **UI language German;** code, comments and identifiers English.
- **No login.** Access is a token in the URL hash; never put it in the repo.
- **Backend is fixed.** Use exactly the API in this tab. If something seems missing, solve it client-side or flag it in the README; don't assume new endpoints.

## Files, config and deployment

| File | Purpose |
| --- | --- |
| `index.html` | Shell: meta viewport, OG tags, `<div id="app">`, `<script type="module" src="app.js">` |
| `config.js` | `export const API_URL = 'https://script.google.com/macros/s/.../exec';` and `export const MODE = 'seats';` (`'seats'`, `'ranks'` or `'both'`) |
| `app.js` | Root component, state, routing by hash |
| `api.js` | `getState()`, `setSeat()`, `setRank()`, `remove()`; all network code |
| `boat.js` | `BoatDiagram` component (see Boat diagram) |
| `format.js` | Date and time labels, WhatsApp text |
| `style.css` | All styles, CSS variables for colours, light and dark via `prefers-color-scheme` |
| `vendor/standalone.module.js` | Preact + hooks + htm |
| `og.png` | 1200 × 630 preview image for WhatsApp |
| `README.md` | How to set `API_URL`, deploy, and build the member link |

- **Token and session from the hash:** the link is `https://<user>.github.io/<repo>/#t=<TOKEN>&s=<session_id>`. `s` is optional. Parse with `URLSearchParams(location.hash.slice(1))`.
- **Persist the token** in `localStorage` (`rudern.token`) so a bookmark without hash still works. A token in the hash always wins over the stored one.
- **No token at all:** show only the text "Bitte öffne den Link aus der WhatsApp-Gruppe." and make no API calls.
- **Deploy:** push to `main`, GitHub Pages serves from the repo root. All paths relative (`./app.js`) so the site works under `/<repo>/`.
- **`MODE`:** the team hasn't decided between seat claims and ranked wishes. Build both. `seats` shows tappable seats only, `ranks` shows Prio buttons only, `both` shows both.

## API contract

Two calls, both to `API_URL`. Every response is JSON with `ok: true` or `ok: false` plus `error`. HTTP status is always 200, so check `ok`, not the status.

**Read state**

```javascript
const res = await fetch(`${API_URL}?action=state&t=${encodeURIComponent(token)}`);
const data = await res.json();
```

```json
{
  "ok": true,
  "version": "42",
  "boats": [
    {"boat_id": "hansa", "name": "Hansa", "klasse": "Gig", "typ": "4x+", "seats": 4,
     "cox": true, "bookable": true, "notes": "Steuer klemmt leicht"}
  ],
  "sessions": [
    {"session_id": "abc123_20261117T170000Z", "name": "Rudern", "date": "2026-11-17",
     "start": "18:00", "end": "19:30", "status": "aktiv", "locked": false}
  ],
  "signups": [
    {"session_id": "abc123_20261117T170000Z", "member_id": "Anna B", "boat_id": "hansa",
     "seat": "3", "rank": null}
  ]
}
```

- `sessions`: today and later, sorted by date and start. `status` is `aktiv` or `abgesagt`. `locked` is true from `LOCK_HOURS` before the start; it can be up to 30 s stale.
- `seat`: string `"1"` to `String(seats)`, or `"St"` for the cox seat (only when `cox` is true), or `null` for a ranked wish.
- `rank`: 1 to 3, or `null` for a seat claim.
- `member_id` is the name the member typed. Compare names case-insensitively.

**Write**

POST a JSON string as the body and set no headers. The browser then sends `text/plain`, which avoids a CORS preflight the backend can't answer. Redirects are followed automatically.

```javascript
const res = await fetch(API_URL, {method: 'POST', body: JSON.stringify(payload)});
const data = await res.json(); // {ok: true, version} or {ok: false, error}
```

| Action | Payload |
| --- | --- |
| Claim a seat | `{action: 'set', t, session_id, member_id, boat_id, seat: '3'}` |
| Ranked wish | `{action: 'set', t, session_id, member_id, boat_id, rank: 1}` |
| Withdraw from a boat | `{action: 'remove', t, session_id, member_id, boat_id}` |

Backend rules the UI must mirror (the backend enforces them anyway):

- A member holds at most one seat per session. Claiming a new seat moves them; the old seat frees up.
- Per session, one ranked wish per boat and one boat per rank. Setting rank 1 on a new boat replaces the old rank-1 boat.
- `remove` deletes both the seat and the wish of that member in that boat.
- Names: trimmed, inner spaces collapsed, 1 to 40 characters.

| `error` | Meaning |
| --- | --- |
| `forbidden` | Token missing or wrong |
| `unknown_session` | Session no longer in the list (past or removed) |
| `cancelled` | Session is abgesagt |
| `locked` | Sign-up closed |
| `unknown_boat` | `boat_id` not in Boote |
| `boat_unavailable` | Boat not befahrbar |
| `bad_seat` | Seat number out of range, or `St` on a boat without cox |
| `seat_taken` | Someone else got the seat first |
| `bad_rank` | Rank not 1 to 3 |
| `bad_name` | Empty or longer than 40 characters |
| `bad_json`, `unknown_action`, other text | Bug or backend error; show a generic message |

## Screens and behaviour

One page, three stacked areas: header, boat list, bottom bar.

**Header**

- Name field ("Dein Name") with a `<datalist>` of all distinct `member_id` values from `signups`. Saved to `localStorage` (`rudern.name`) on blur. Normalise like the backend (trim, collapse spaces).
- Session tabs: one per entry in `sessions`, label like "Di 17.11. 18:00" (German weekday abbreviation). Horizontally scrollable. Preselect the hash's `s` if present and known, else the first `aktiv` session. Keep the selected session in the hash (`history.replaceState`) so sharing the URL keeps it.
- Tabs for `abgesagt` sessions are struck through and show "abgesagt" instead of the boat list. Locked sessions show the boats read-only with a banner "Anmeldung geschlossen".

**Boat list** (for the selected session)

- One card per boat, in the order of `boats`. Card shows `name`, a `typ` badge, `klasse` and `notes` if present, the diagram, and a short line of who is in the boat.
- `bookable: false`: card greyed, diagram without tap targets, label "nicht befahrbar". Sort these to the end.
- In `ranks` or `both` mode, each card has three small toggle buttons "1", "2", "3". The active one is the member's current rank for that boat. Tapping the active one withdraws (`remove`).
- Wishes from other members appear as a line "Wünsche: Anna (1), Ben (2)".

**Seat interaction** (`seats` or `both` mode)

- Empty seat: claim it (`set` with `seat`). If the member already has a seat in this session, it moves.
- Own seat: withdraw (`remove`).
- Someone else's seat: show their name in a small tooltip or toast; no write.
- No name entered yet: focus the name field and show "Bitte zuerst deinen Namen eingeben"; no write.

**Bottom bar**

- "Meine Termine": the member's seats and wishes across all sessions, each tappable to jump to that session.
- "In WhatsApp teilen": opens `https://wa.me/?text=` + `encodeURIComponent(text)`, where text is the session label, then one line per boat with people ("Hansa (4x+): 1 Anna, 2 Ben, St Carl"), then the page link without the token hash. Members open the link from the group description.

**Data flow and snappiness**

- On load: render immediately from `localStorage` (`rudern.state`) if present, then fetch fresh state.
- Refetch when the tab becomes visible (`visibilitychange`) and every 30 s while visible. Ignore a response whose `version` equals the current one.
- Writes are optimistic: update local state at once, send the request, and on `ok: false` roll back and show the error text as a toast for 4 s. On `ok: true`, store the new `version` and refetch in the background.
- Disable the seat being written until its request finishes, so double taps don't send twice. Other seats stay usable.
- Network failure: roll back, toast "Keine Verbindung, bitte erneut versuchen".

## Boat diagram

The team will refine the look later, so build a clean, swappable component with all geometry constants at the top of `boat.js`. Inline SVG, drawn from the boat data only. No images, no per-boat code.

```javascript
// boat.js
export function BoatDiagram({boat, signups, me, disabled, pendingSeat, onSeat}) { /* returns <svg> */ }
// boat:     one entry of state.boats
// signups:  state.signups filtered to this session and boat, seat !== null
// me:       normalised member name or ''
// disabled: true when locked, abgesagt, not bookable or MODE === 'ranks'
// onSeat(seat): called with '1'..'n' or 'St'
```

**Geometry**

- Top view of a hull: a long, pointed shape, bow on the left, stern on the right.
- One seat slot per rower, numbered from the bow: seat 1 nearest the bow, seat `seats` (stroke) nearest the stern. Coxed boats (`cox: true`) get one more slot behind the stroke, at the stern, labelled `St`.
- Sculling boats (`typ` contains `x`): two oar stubs per seat, one on each side.
- Sweep boats (`typ` contains `-` or `+` but no `x`): one oar stub per seat, alternating sides. Default rig: the stroke seat's oar is on the lower edge, then alternate towards the bow. Keep the rig a constant so it can be flipped later.
- Seat count comes from `boat.seats`; never parse `typ` for it.

**Orientation and tap targets**

- Each slot is at least 48 × 48 CSS px, and the whole slot is the tap target, not just the drawn circle.
- Draw horizontally when the card is wide enough for all slots plus bow and stern. Otherwise draw vertically, bow at the top. Decide with a `ResizeObserver` on the card. On a 360 px phone a 1x, 2x and 4x+ fit horizontally; an 8+ goes vertical.
- Seats are focusable (`role="button"`, `tabindex="0"`), activate on Enter and Space, and have an `aria-label` like "Platz 3, frei", "Platz 3, Anna B" or "Steuerplatz, frei".

**Seat states** (colours via CSS variables, readable in light and dark)

| State | Look |
| --- | --- |
| Free | Outline circle, seat number inside |
| Taken | Filled neutral circle, initials (max 2 letters), seat number small below |
| Mine | Filled accent colour, initials, slightly bolder outline |
| Pending write | Like the target state, with a subtle pulse; not tappable |
| Disabled | Whole diagram at reduced opacity, no hover or tap |

## UI texts and acceptance checklist

Keep all strings in one object in `format.js` so they can be edited in one place.

| Key | Text |
| --- | --- |
| `nameLabel` | Dein Name |
| `needName` | Bitte zuerst deinen Namen eingeben |
| `noToken` | Bitte öffne den Link aus der WhatsApp-Gruppe. |
| `noSessions` | Gerade sind keine Termine zur Anmeldung offen. |
| `cancelled` | abgesagt |
| `locked` | Anmeldung geschlossen |
| `notBookable` | nicht befahrbar |
| `wishes` | Wünsche |
| `myDates` | Meine Termine |
| `share` | In WhatsApp teilen |
| `offline` | Keine Verbindung, bitte erneut versuchen |
| `err.seat_taken` | Der Platz wurde gerade vergeben. |
| `err.locked` | Die Anmeldung für diesen Termin ist geschlossen. |
| `err.cancelled` | Dieser Termin wurde abgesagt. |
| `err.boat_unavailable` | Dieses Boot ist gerade nicht befahrbar. |
| `err.forbidden` | Der Link ist ungültig. Bitte den aktuellen Link aus der WhatsApp-Gruppe öffnen. |
| `err.bad_name` | Bitte einen Namen mit höchstens 40 Zeichen eingeben. |
| `err.default` | Das hat nicht geklappt. Bitte erneut versuchen. |

**Acceptance checklist** (the implementing agent ticks these before handing back)

- [ ] Opening the link with `#t=` on a phone shows sessions and boats within 2 s on a normal connection; a second visit renders instantly from cache.
- [ ] Claiming a free seat fills it immediately and the row appears in `Anmeldungen`.
- [ ] Claiming a second seat in the same session moves the member; the first seat shows free.
- [ ] Tapping one's own seat frees it; tapping someone else's shows their name and writes nothing.
- [ ] Two phones claiming the same seat: one wins, the other rolls back with `err.seat_taken`.
- [ ] Locked and abgesagt sessions and non-befahrbar boats cannot be written from the UI.
- [ ] `MODE` `seats`, `ranks` and `both` all work; Prio 1 to 3 follows the one-boat-per-rank rule.
- [ ] Wrong token shows `err.forbidden`; no token shows `noToken` and makes no request.
- [ ] 1x, 2x, 4x+ and 8+ render correctly, horizontally where they fit and vertically where they don't; every seat tap target is at least 48 px.
- [ ] Keyboard: Tab reaches every seat and button; Enter and Space activate.
- [ ] The WhatsApp button opens WhatsApp with the lineup text and a link without the token.
- [ ] No token, name or API secret is committed to the repo; `API_URL` is the only backend value in the code.
- [ ] README explains: set `API_URL` in `config.js`, enable Pages, build the member link `https://<user>.github.io/<repo>/#t=<TOKEN>`.

**Out of scope:** admin functions, editing boats or sessions, push notifications, offline writes, analytics.
