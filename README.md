# Rudern Anmeldung

Member-facing page for the rowing team: open the link, type your name, pick a seat in a boat (or a ranked wish) for an upcoming session. Static site (Preact + htm, vendored, no build step) talking to the Google Apps Script backend described in `docs/backend_setup.md`.

## Set up

1. **API URL.** Set `API_URL` in `src/config.js` to the web app URL of the deployment (ends in `/exec`). It is the only backend value in the code.
2. **Mode.** Set `MODE` in `src/config.js` to `'seats'` (tappable seats), `'ranks'` (Prio 1 to 3 buttons) or `'both'`.
3. **Enable GitHub Pages.** Repo, Settings, Pages, Source: **GitHub Actions**. The workflow `.github/workflows/pages.yml` publishes the contents of `src/` (without `Code.gs`) on every push to `main`. No build step: the files are served as they are.
4. **Member link.** Build it from the Pages URL and the `TOKEN` script property of the backend:

   ```
   https://<user>.github.io/<repo>/#t=<TOKEN>
   ```

   Optionally add `&s=<session_id>` to open a specific session. Post the link in the WhatsApp group description. The token is read from the URL hash and kept in the browser's `localStorage`, so a bookmark without the hash keeps working. **Never commit the token.** Rotating it (see backend setup) invalidates old links.

Set the `og:image` URL in `src/index.html` if the repo is not `KylianSchmidt/KIT-HSP-Rudern-Terminplaner`: WhatsApp needs an absolute URL there.

## Files

| File (in `src/`) | Purpose |
| --- | --- |
| `index.html` | Shell and OG tags |
| `config.js` | `API_URL`, `MODE` |
| `app.js` | Root component, state, hash routing, optimistic writes, polling |
| `api.js` | All network code |
| `boat.js` | `BoatDiagram`; all geometry constants at the top |
| `format.js` | Date labels, WhatsApp text and **all UI strings** |
| `style.css` | Styles, light and dark via `prefers-color-scheme` |
| `vendor/standalone.module.js` | Preact + hooks + htm, copied from `https://unpkg.com/htm@3/preact/standalone.module.js` |
| `og.png` | 1200 x 630 preview image |

The backend source `src/Code.gs` sits in the same folder but is not published.

## Run locally

Any static file server works, e.g. `python3 -m http.server` in `src/`, then open `http://localhost:8000/#t=<TOKEN>`. (ES modules do not load from `file://`.)

## Limits of the backend the UI works around

- `remove` deletes both the seat **and** the wish of that member in that boat. In `both` mode, withdrawing a Prio also frees the member's seat in the same boat, and the other way round. The UI mirrors this, because the backend has no endpoint to remove only one of them.
- `locked` can be up to 30 s stale. The backend enforces the lock anyway; a late tap shows the `locked` error and rolls back.
- When the version is unchanged, the page still takes over the `sessions` list from the response, so a session that locks over time is shown as locked without waiting for a sign-up to bump the version.
