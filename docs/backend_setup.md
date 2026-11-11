# Backend setup

Seven steps in the browser (the [README](../README.md) shows where they fit in the full setup) turn the Sheet and calendar into a working API. At the end you have a web app URL and a token for the frontend.

## Before you start

Do everything below logged into the Google account that owns the Sheet. That account must have edit rights on the calendar, because the script runs as that account.

- Tab `Boote` with headers: Name, Boot\_ID, Klasse, Typ, Steuerperson, Befahrbar, Bemerkungen. Every boat needs a `Boot_ID` (short, no spaces, e.g. `hansa`). `Klasse` contains the seat configuration (1x, 2-, 4x+, 8+); `Typ` is the boat type (e.g. Gigboot, Rennboot).
- Tab `Termine` with headers: Name, Termin\_ID, Datum, Beginn, Ende, Status. Leave it empty: the script fills it.
- Tab `Anmeldungen` with headers: Termin\_ID, Mitglied\_ID, Boot\_ID, Platz, Prio, Geandert. Leave it empty.
- At least one calendar event in the next 14 days with "@anmeldung" in its description, for testing.
- The calendar ID: Google Calendar, then Settings, then the calendar, then "Integrate calendar", then "Calendar ID" (looks like `abc123@group.calendar.google.com`).

## Steps 1 to 3: create the script

1. In the Sheet: **Extensions → Apps Script**. This creates a script bound to the Sheet. Rename the project to "Rudern Backend".
2. Click the gear (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**. Back in the editor, open `appsscript.json` and replace its content with the manifest below. It sets the time zone, turns on the advanced Calendar service and sets the web app defaults.
3. Open `Code.gs`, delete its content, paste the full script from `src/Code.gs` and save (Ctrl+S).

```json
{
  "timeZone": "Europe/Berlin",
  "dependencies": {
    "enabledAdvancedServices": [
      {"userSymbol": "Calendar", "serviceId": "calendar", "version": "v3"}
    ]
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {"executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS"}
}
```

## Code.gs

The whole backend in one file. Seats are numbered from 1; the cox seat is `St`. A seat claim replaces the member's other seat in the same session, and ranked wishes (Prio 1 to 3) can sit alongside it.

The source is [`src/Code.gs`](../src/Code.gs). Copy its full content into the Apps Script editor (step 3).

## Steps 4 to 6: configure, initialise, deploy

4. **Script properties.** Project Settings, scroll to **Script Properties**, **Add script property** for each row. `TOKEN` is created by `setup()`, so leave it out.

| Property | Value | Note |
| --- | --- | --- |
| CALENDAR\_ID | `abc123@group.calendar.google.com` | From "Before you start" |
| MARKER | `@anmeldung` | Events whose description contains this text (any case) become sessions |
| LOCK\_HOURS | `2` | Sign-ups close this many hours before Beginn |
| PAGE\_URL | `https://<user>.github.io/<repo>/` | Can be added later; only used for links in events |

5. **Run setup once.** In the editor toolbar pick `setup` in the function dropdown and click **Run**. Google asks for permissions: **Review permissions**, choose the account, **Advanced**, **Go to Rudern Backend (unsafe)**, **Allow**. The warning appears because the script is your own and unverified. `setup()` checks the headers, sets the ID, date and time columns to plain text, creates the token and both triggers, and runs a first calendar sync.
  - Check: the execution log shows `TOKEN: ...`. Copy it.
  - Check: `Termine` now has a row for each event marked "@anmeldung" in the next 14 days, and those events contain a `--- Boote ---` block.
6. **Deploy as web app.** **Deploy → New deployment**, gear icon, **Web app**. Description `v1`, Execute as **Me**, Who has access **Anyone**, then **Deploy**. Copy the **Web app URL** (ends in `/exec`). The frontend needs this URL; members need the page link with `#t=<TOKEN>`.

## Step 7: test

Fill in the three values, then run the commands in any terminal. Take a `Termin_ID` from the `Termine` tab and a `Boot_ID` from `Boote`.

```bash
URL='https://script.google.com/macros/s/XXXX/exec'
T='your-token'
SID='termin-id-from-Termine'

# 1. Read state: expect "ok":true with boats and sessions
curl -sL "$URL?action=state&t=$T"

# 2. Claim seat 1 in boat hansa: expect {"ok":true,...}
curl -sL -H 'Content-Type: text/plain' \
  -d '{"action":"set","t":"'$T'","session_id":"'$SID'","member_id":"Test T","boat_id":"hansa","seat":"1"}' "$URL"

# 3. Wrong token: expect {"ok":false,"error":"forbidden"}
curl -sL "$URL?action=state&t=wrong"

# 4. Remove the test sign-up again
curl -sL -H 'Content-Type: text/plain' \
  -d '{"action":"remove","t":"'$T'","session_id":"'$SID'","member_id":"Test T","boat_id":"hansa"}' "$URL"
```

After step 2 the row appears in `Anmeldungen`; within 10 minutes the event description lists "1 Test T". Possible errors from a write: `unknown_session`, `cancelled`, `locked`, `unknown_boat`, `boat_unavailable`, `bad_seat`, `seat_taken`, `bad_rank`, `bad_name`.

## Updating and troubleshooting

**Changing the code later:** edit `Code.gs`, save, then **Deploy → Manage deployments**, pencil icon, Version **New version**, **Deploy**. The URL stays the same. Saving alone does not change what the web app runs; triggers use the saved code straight away.

**Rotating the token:** delete `TOKEN` in Script Properties, run `setup()` again, and post the new link in WhatsApp. Old links stop working at once.

| Symptom | Cause and fix |
| --- | --- |
| `ReferenceError: Calendar is not defined` | Manifest not saved. Redo step 2 |
| `Tab not found` or `missing columns` | Tab or header spelled differently. Headers must match exactly, including case |
| Events don't show up in `Termine` | Description lacks the `MARKER` text, the event is all-day, it's more than 14 days ahead, or `CALENDAR_ID` is wrong. Run `syncEvents` by hand and read **Executions** |
| `forbidden` | Token in the link differs from `TOKEN` |
| Page can't reach the API | Deployment access is not **Anyone**, or the URL is from **Test deployments** instead of the `/exec` URL |
| Write returns `locked` | The session starts within `LOCK_HOURS`; admins can still edit `Anmeldungen` directly |
| Error emails from Google about `syncEvents` | Usually a one-off API hiccup; check **Executions**. Repeated failures point to calendar rights or the calendar ID |
| `calendar.events.list failed with error: Not Found` | CALENDAR\_ID is wrong, or the script's account can't see the calendar. Run listCalendars and copy the ID from the log. The calendar must show owner or writer; if it's missing or read-only, share it with the Sheet owner's account with "Make changes to events". |