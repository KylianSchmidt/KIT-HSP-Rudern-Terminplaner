# Data model and calendar

One Google Sheet with three tabs. Admins edit `Boote` by hand and create training events in Google Calendar; the script writes `Termine` and `Anmeldungen`. There is no member list and no log tab.

| Tab | Columns | Written by |
| --- | --- | --- |
| Boote | Name, Boot_ID, Klasse, Typ, Steuerperson (ja/nein), Befahrbar (ja/nein), Bemerkungen | Admin |
| Termine | Name (event title, display only), Termin_ID, Datum, Beginn, Ende, Status (aktiv, abgesagt) | Script, from matching calendar events |
| Anmeldungen | Termin_ID, Mitglied_ID, Boot_ID, Platz (or empty), Prio (1 to 3, or empty), Geandert | Script |

The script finds columns by header name, so order does not matter, but spelling and case must match exactly. In code and the API the fields have English names: `Boot_ID` is `boat_id`, `Termin_ID` is `session_id`, `Mitglied_ID` is `member_id`.

## Boote

- `Boot_ID`: short stable string without spaces (e.g. `hansa`). Boat names can change without breaking sign-ups.
- `Klasse`: seat configuration, e.g. `1x`, `2x`, `2-`, `4x`, `4x+`, `4-`, `8+`. The seat count is the number in it; `x` means sculling, `-` or `+` sweep.
- `Typ`: boat type, e.g. `Gigboot`, `Rennboot`.
- `Steuerperson` `ja`: the boat has a cox seat (`St`) behind the stroke.
- `Befahrbar` `nein`: the boat is shown greyed out and cannot be picked.
- `Bemerkungen` and `Klasse` appear on the boat card.
- New boats need no frontend change: the diagram is drawn from `Klasse` and `Steuerperson`.

## Termine

Created by the calendar sync, never by hand. `Termin_ID` is the calendar's instance ID: unique per occurrence of a recurring event and unchanged when the event is moved. Dates and times are ISO strings (`YYYY-MM-DD`, `HH:mm`); the script project time zone is Europe/Berlin.

## Anmeldungen

- `Mitglied_ID` is the display name the member typed (first name and initial). No emails or phone numbers. Names are compared case-insensitively.
- `Platz` is `1` to the seat count, or `St` for the cox, or empty for a category choice (`Boot_ID` is `cat:<Typ>|<Klasse>`) or "Noch ohne Wahl" (`cat:unsure`). `Prio` is unused.
- One choice per member and session; a new choice (seat, category or unsure) replaces the old one.
- `Geandert` is the timestamp of the last change. Together with the Sheet's version history it is the only audit trail.
- Delete rows of past sessions after one season.

## Calendar pickup

Admins register a session by writing `@anmeldung` in the description of any calendar event. The title does not matter; it is only shown as the session name.

- **Matching:** the description contains the `MARKER` (any case, anywhere, formatting allowed). One-off and recurring events both work. All-day events are ignored. Removing the marker cancels the session and removes the link block from the event.
- **Pickup:** a trigger every 10 minutes scans the next 14 days (`singleEvents=true`). New matches create a `Termine` row. A moved event updates Datum, Beginn and Ende. A deleted event sets `Status = abgesagt` and keeps its sign-ups.
- **Feedback for admins:** the script appends a block between `--- Boote ---` and `--- Ende ---` to the event description with the page link for that session (`#t=...&s=<session_id>`) and the current lineup. Text above the block is never touched. A link appearing in the event confirms it is registered.
- **Locking:** sign-ups lock `LOCK_HOURS` before `Beginn`. The lock applies only to the API; admins can still edit `Anmeldungen` directly.
- **Members** see events in the shared calendar. The calendar must never be public; share it by account or secret iCal address, the same audience as the WhatsApp group.
- **Edits in the Sheet:** an `onEdit` trigger bumps `version` and clears the cache so clients notice admin changes.

Registering sessions by WhatsApp message is not workable for free: reading group messages needs the paid WhatsApp Business API or an unofficial bot on a running server.

## WhatsApp

The link with the token is pinned in the group description. `og:title`, `og:description` and `og:image` give the link a preview card.
