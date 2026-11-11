# API, security and privacy

## API

One Apps Script web app (`doGet` / `doPost`), deployed with "Execute as: Me" and "Who has access: Anyone". Every call carries the token `t`; a wrong token returns `{ok:false, error:"forbidden"}`. HTTP status is always 200, so clients check `ok`.

| Call | Request | Returns |
| --- | --- | --- |
| Read state | `GET ?action=state&t=...` | boats, sessions for the next 14 days, signups for those sessions, server `version` |
| Sign up / change | `POST {action:"set", t, session_id, member_id, boat_id, seat?}` | `{ok, version}` or `{ok:false, error}` |
| Withdraw | `POST {action:"remove", t, session_id, member_id, boat_id}` | `{ok, version}` |

- POST bodies are a JSON string sent as `text/plain` with no headers. That avoids the CORS preflight, which Apps Script cannot answer.
- Every write runs inside `LockService.getScriptLock()`, re-checks the seat, writes `Anmeldungen` (setting `Geandert`) and bumps `version`.
- `state` is cached in `CacheService` for 30 s and invalidated on each write.
- Admin tasks (event pickup, lock, calendar sync) are time-driven triggers, not public endpoints.
- Response shapes, the full list of error codes and their UI texts are in the [Frontend spec](Frontend%20spec.md#api-contract). Command-line examples are in [backend_setup.md](backend_setup.md#step-7-test).

## Security and privacy

The model is "whoever has the link can sign up", made traceable and reversible rather than locked down.

- **Link token:** the page URL is `https://<user>.github.io/<repo>/#t=<token>`. The hash never reaches GitHub's servers or logs. The script compares it to `TOKEN` in Script Properties. Rotate it by deleting the property, running `setup()` and reposting the link.
- **Nothing secret in the repo:** the repo is public (free GitHub Pages), so it holds only the script URL. Token and calendar ID live in Script Properties. The URL alone grants nothing.
- **Reads need the token too:** without it the API returns nothing, so member names are not public.
- **Self-declared identity:** members type their name. Mitigations: the `Geandert` column, the Sheet's version history and admin override in the Sheet. Add a log tab or per-member tokens if impersonation ever happens.
- **Abuse limits:** one choice per member per session, names up to 40 characters, sessions lock `LOCK_HOURS` before start.
- **Calendar:** event descriptions contain the token link, so never make the calendar public.
- **GDPR:** display names only, data stays in the admin's Google account, a short note on the page says what is stored and who to ask for deletion. Delete `Anmeldungen` rows of past sessions after one season.
