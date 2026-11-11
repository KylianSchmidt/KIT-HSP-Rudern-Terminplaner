# Decisions, status and handover

## Goals and non-goals

A free web app where team members pick a boat (and seat) for each of the weekly training days, with zero servers to run and a handover that fits on one page. Non-goals for v1: payments, regatta entries, erg logs, push notifications, native app.

## Frontend choice

| Option | Build step | Size | Verdict |
| --- | --- | --- | --- |
| Vanilla JS + SVG | None | Smallest | Fine for v1, state handling gets messy |
| **Preact + htm (vendored)** | None | ~5 kB | **Chosen.** Component code, no tooling to install |
| Svelte + Vite via GitHub Actions | Yes | Small | Good if the maintainer is a web dev |
| React / Next.js | Yes | Large | Overkill |

Keeping it snappy: render from the `localStorage` cache first, optimistic writes with rollback and toast, one GET for 14 days, refetch on tab focus and every 30 s (skipped if `version` is unchanged), no web fonts, under 50 kB without the vendor file. Behaviour and layout: [Frontend spec](Frontend%20spec.md).

## Status

| Phase | State |
| --- | --- |
| 0 Setup (Sheet, repo, Pages) | done |
| 1 Backend (API, sync, deploy, curl tests) | done |
| 2 Frontend MVP | in progress (uncommitted changes in `src/`) |
| 3 Boat diagrams for every type | in progress |
| 4 Calendar sync: lineup block, lock trigger | backend written; verify end to end |
| 5 WhatsApp share, OG tags, privacy note, one-week pilot | open |
| 6 Handover: second admin, ownership transfer | open |

**Frontend and backend currently disagree.** The frontend works with one choice per member and session, either a seat or a whole boat category (`boat_id = "cat:<typ>|<klasse>"`, no seat). `Code.gs` validates `boat_id` against `Boote` and returns `unknown_boat` for categories, and its `remove` ignores `seat`. Until the backend is extended (or the frontend goes back to seats and ranks), categories only work with `#mock`. The old `MODE` switch (`seats`, `ranks`, `both`) was removed from `config.js`.

## Consistency check

| # | Tension | Resolution |
| --- | --- | --- |
| 1 | Seat claims vs ranked preferences need different rules | Data model supports both (`seat` or `rank`); see the open decision below |
| 2 | "Snappy UI" vs Apps Script at 1 to 3 s per call | Optimistic updates, `localStorage` cache, one GET, `CacheService` |
| 3 | Free Pages needs a public repo, the API must stay private | Token only in the URL hash and Script Properties |
| 4 | Link with token sits in calendar event descriptions | Never make the calendar public |
| 5 | Admin edits in the Sheet don't bump `version` | `onEdit` trigger bumps it and clears the cache |
| 6 | "Lineup in the calendar within 10 min" vs slow iCal refresh | Holds in Google Calendar; other apps may lag hours, the web app is the live view |
| 7 | Sessions lock but coaches may still change crews | Locks apply only to the API; admins edit the Sheet |
| 8 | A bound script belongs to the Sheet owner's account | Use a club account; transferring Sheet ownership moves the script |
| 9 | Dates drift by a day across Apps Script, Sheet and browser | Time zone Europe/Berlin; ISO strings, never `Date` in JSON |
| 10 | Apps Script quotas on free accounts | About 90 min/day trigger runtime, 30 simultaneous executions; far above our use. Re-check the [quota page](https://developers.google.com/apps-script/guides/services/quotas) before launch |
| 11 | Free-text names can be mistyped | Name field autocompletes from used names and is remembered per device; admins fix typos in the Sheet |
| 12 | Calendar holds non-rowing events | Only events with the marker are picked up; no link in the event means not registered |
| 13 | Script writes into descriptions that admins also edit | Only the block between the `--- Boote ---` markers is rewritten |
| 14 | Recurring events share one event ID | `Termin_ID` is the instance ID, unique per occurrence |
| 15 | Events moved or deleted after sign-ups | Moves update the session; deletes set `abgesagt` and keep sign-ups |
| 16 | No log tab | `Geandert` plus Sheet version history; add a log tab if misuse happens |

## Open decisions

- [ ] Seat claims, ranked preferences, whole-category choices, or a mix (the coach builds crews from them)?
- [ ] Lock time (`LOCK_HOURS`, currently 2)
- [ ] Which calendar holds the events
- [ ] Boat list with types, and whether coxes sign up like rowers
- [ ] Club Google account: who owns it, who is second admin
- [ ] Boat diagram style (top-down hull, simple seat row, per-boat artwork)

## Handover checklist

- [ ] Sheet and script owned by the club account; second admin added to both
- [ ] Someone other than the author redeploys from the README alone
- [ ] Token rotation, redeploy and ownership transfer tried once ([backend_setup.md](backend_setup.md#updating-and-troubleshooting))
