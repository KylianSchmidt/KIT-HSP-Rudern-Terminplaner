# Rudern Anmeldung

Rowing team sign-up. Members open one link (pinned in WhatsApp or taken from a calendar event), type their name and pick a seat in a boat for an upcoming training session. No servers to run, no login for members, all free.

## How it works

```
 Member's phone ──► GitHub Pages (static page, src/*.js)
                        │  fetch, token from URL hash
                        ▼
                Google Apps Script web app (src/Code.gs)
                   │                     ▲
        reads/writes                     │ every 10 min: scan events
                   ▼                     │ marked "@anmeldung", write the
              Google Sheet ◄─────────────┘ link + lineup back into them
        (Boote, Termine, Anmeldungen)         Google Calendar
```

| Part | Role |
| --- | --- |
| **Google Calendar** | Admins create training events and write `@anmeldung` in the description. That registers a session. |
| **Google Apps Script** | The whole backend: `doGet`/`doPost` API, a 10-minute calendar sync trigger, locking, caching. |
| **Google Sheet** | The database. `Boote` is edited by admins; `Termine` and `Anmeldungen` are written by the script. |
| **GitHub Pages** | Hosts the member-facing page. Preact + htm, vendored, no build step. |
| **Token** | A secret in the link (`#t=<TOKEN>`). Without it the API returns nothing. The hash never reaches any server log. |

Roles: **members** sign up, change and withdraw. **Admins** (one or two) maintain the boat list and calendar events, and can edit the Sheet directly (for example to fix a crew after sign-ups lock).

## Set up from scratch

You need a Google account (preferably a club account, so the next admin can take over), a GitHub account and about 45 minutes. Detailed instructions for each phase are linked.

1. **Create the Sheet.** New Google Sheet with three tabs, exact names and headers (case-sensitive):
   - `Boote`: Name, Boot_ID, Klasse, Typ, Steuerperson, Befahrbar, Bemerkungen. Fill one row per boat. [Details](docs/data-model.md)
   - `Termine`: Name, Termin_ID, Datum, Beginn, Ende, Status. Leave empty.
   - `Anmeldungen`: Termin_ID, Mitglied_ID, Boot_ID, Platz, Prio, Geandert. Leave empty.
2. **Prepare the calendar.** Use a calendar the account can edit. Copy its Calendar ID (Calendar settings, Integrate calendar). Create a test event in the next 14 days with `@anmeldung` in its description.
3. **Create the backend script.** In the Sheet: Extensions, Apps Script. Paste the manifest and [src/Code.gs](src/Code.gs). [Steps 1 to 3](docs/backend_setup.md)
4. **Set Script Properties** `CALENDAR_ID`, `MARKER`, `LOCK_HOURS`, `PAGE_URL`. [Step 4](docs/backend_setup.md)
5. **Run `setup()` once** and authorise it. It checks the headers, creates the `TOKEN` and the triggers, and runs a first calendar sync. Copy the `TOKEN` from the log. [Step 5](docs/backend_setup.md)
6. **Deploy as web app** (execute as Me, access Anyone) and copy the `/exec` URL. [Step 6](docs/backend_setup.md)
7. **Test the API with `curl`** (read, claim, wrong token, remove). [Step 7](docs/backend_setup.md)
8. **Fork or create the GitHub repo** with this code. Edit `src/config.js` and set `API_URL` to the `/exec` URL. If the repo is not `KylianSchmidt/KIT-HSP-Rudern-Terminplaner`, also change the absolute `og:image` URL in `src/index.html` (WhatsApp needs it).
9. **Enable GitHub Pages.** Repo, Settings, Pages, Source: **GitHub Actions**. Push to `main`; [the workflow](.github/workflows/pages.yml) publishes `src/` without `Code.gs`.
10. **Set `PAGE_URL`** in the Script Properties to `https://<user>.github.io/<repo>/` (if not done in step 4) and wait for the next sync so event descriptions get the correct link.
11. **Build the member link and share it:**

    ```
    https://<user>.github.io/<repo>/#t=<TOKEN>
    ```

    Optionally add `&s=<session_id>` to open a specific session (the sync already puts this link into each event). Pin the link in the WhatsApp group description. **Never commit the token.**
12. **Check it works:** open the link on a phone, enter a name, tap a seat. The row appears in `Anmeldungen`, and within 10 minutes the event description shows the lineup.

Rotate the token, redeploy after code changes, and fix common errors: [docs/backend_setup.md](docs/backend_setup.md#updating-and-troubleshooting).

## Run the frontend locally

Any static server works. ES modules do not load from `file://`.

```bash
cd src && python3 -m http.server      # then open http://localhost:8000/#t=<TOKEN>
```

Open `http://localhost:8000/#mock` to use an in-memory fake backend (`src/mock.js`) with sample boats and sessions, no token needed.

## Files in `src/`

| File | Purpose |
| --- | --- |
| `index.html` | Shell and OG tags |
| `config.js` | `API_URL`, the only backend value in the code |
| `app.js` | Root component, state, hash routing, optimistic writes, polling |
| `api.js` | All network code |
| `choices.js` | Choice model (seat or boat category), grouping of boats |
| `boat.js` | `BoatDiagram`; geometry constants at the top |
| `format.js` | Date labels, WhatsApp text and **all UI strings** (German) |
| `style.css` | Styles, light and dark via `prefers-color-scheme` |
| `mock.js` | In-memory backend for design previews (`#mock`) |
| `vendor/standalone.module.js` | Preact + hooks + htm, from `https://unpkg.com/htm@3/preact/standalone.module.js` |
| `og.png` | 1200 x 630 preview image |
| `Code.gs` | The backend. Lives here but is **not** published to Pages; paste it into Apps Script by hand |

## Known limits

- `remove` deletes both the seat and the wish of that member in that boat. The UI mirrors this.
- `locked` can be up to 30 s stale; the backend enforces it anyway and a late tap rolls back with an error.
- Category choices (`boat_id` of the form `cat:<typ>|<klasse>`) are not accepted by the current `Code.gs` (`unknown_boat`). They work only against the mock until the backend learns them. The frontend `MODE` switch was removed; there is one choice per member and session.
- Calendar subscribers in other apps may see lineups hours late (iCal refresh). The web app is the live view.

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/backend_setup.md](docs/backend_setup.md) | Manifest, script properties, `setup()`, deploy, `curl` tests, troubleshooting |
| [docs/data-model.md](docs/data-model.md) | Sheet tabs, columns, IDs, calendar pickup rules |
| [docs/api.md](docs/api.md) | Endpoints, security model and privacy |
| [docs/Frontend spec.md](docs/Frontend%20spec.md) | Contract and behaviour of the member page |
| [docs/decisions.md](docs/decisions.md) | Stack choices, consistency check, status and open decisions |
