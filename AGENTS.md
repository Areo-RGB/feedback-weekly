# AGENTS.md

## Project overview

`feedback-weekly` is the standalone H03 attendance dashboard deployed at:

- Production: https://feedback-weekly.vercel.app
- Repository: https://github.com/Areo-RGB/feedback-weekly
- Vercel project: `feedback-weekly`

It reads published Google Forms response data, combines it with the team Google Calendar, and presents:

1. The current Berlin week's Training absences by date.
2. The current week's game Zusagen and Absagen.
3. Training-absence markers beside players who accepted a game, such as `Arvid [X X]` for two Training absences that week.
4. An all-time Training absence table sorted from the fewest absences to the most.

This app is read-only. Form option synchronization and form embedding live in the separate main app repository:

- Main app repository: https://github.com/Areo-RGB/h3_1
- Main app production: https://h03.uk

## Architecture

### Standalone feedback app

- `index.html`: dashboard structure, overview/table views, and footer navigation.
- `styles.css`: responsive dashboard, cards, table, and fixed footer navigation.
- `app.js`: fetches `/api/feedback`, renders both views, refreshes every 60 seconds, and handles manual refresh.
- `api/feedback.mjs`: Vercel serverless function that fetches and aggregates Sheets and Calendar data.
- `package.json`: standalone Node application; `xlsx` parses the published ODS workbook.

### Main H03 app

The related implementation is in `Areo-RGB/h3_1`:

- `src/features/polls/AnwesenheitView.tsx`: embeds the Training and Spiele Google Forms and pre-fills the logged-in player name.
- `functions/api/activities.ts`: reads Calendar events and synchronizes Google Form dropdown options through the Forms API.
- `src/lib/users.ts`: canonical player roster used by the main app.

## Data flow

```text
Google Calendar
  public ICS feed
       |
       +------------------------------+
       |                              |
       v                              v
h3.uk /api/activities          feedback-weekly /api/feedback
       |                              |
       | Forms API                    | Published ODS workbook
       v                              v
Training + Spiele Forms -----> Linked Google Sheets
       |                              |
       v                              v
Embedded forms in h3.uk       Weekly overview + all-time table
```

## Calendar to Google Forms dropdowns

The shared team calendar is read from this public ICS feed:

`https://calendar.google.com/calendar/ical/09d3a4912c1f0189356e2efffafd8eedafbabedb79b3a6a4080ed47dadcb6626%40group.calendar.google.com/public/basic.ics`

The main app's Cloudflare Pages function `/api/activities` performs the synchronization:

1. Fetch the ICS feed.
2. Find events labelled exactly `Training`.
3. Expand the weekly Training recurrences and select the next three dates.
4. Format Training options as `Tag DD.MM.YYYY`, for example `Mittwoch 22.07.2026`.
5. Detect games from a `Spiel`/`Spiele` label or a match title formatted as `Team - Team`.
6. Format game options as `Gegner – DD.MM.YYYY`.
7. Authenticate to Google Forms with the Cloudflare secret `GOOGLE_SERVICE_ACCOUNT_JSON`.
8. Replace each Form dropdown's options only when the Calendar-derived values changed.
9. Return the synchronized Training and Spiele choices to the main app.

Never place the service-account JSON in browser code, Git, or a public environment variable. It is a server-only Cloudflare Pages secret.

## Forms and pre-filling

### Training form

- Public responder form: `1FAIpQLSdr_dv4ue-WXtkRpmEFlKNIC1WRgE1bgBzTxsoRjhlkG3-hdg`
- Editable Forms API ID: `1YOvq5Let5pjrDefdYk_hmiX-bV8lQyCYXpA19p1NLeY`
- Name: `entry.1364644614`
- Training dropdown: `entry.539593056`
- Anwesenheit: `entry.2113903965`

The Training form records absences. A response with a valid Training date is treated as an `Absage`, including older rows where the Anwesenheit cell is empty.

### Spiele form

- Public responder form: `1FAIpQLSdgtDs9vgB7mQSEMZ7kNiqZQ6aqDgXiHjeQ-23edP9ahIh7DA`
- Editable Forms API ID: `16ttyd6qu0NiYnTL2eDZizbDKSzOyrTIkAg3kDoaPNsM`
- Name: `entry.999718010`
- Spiele dropdown: `entry.738056957`
- Anwesenheit: `entry.544451035`

The Spiele form records either `Zusage` or `Absage` for the selected game.

The main app waits for `/api/activities` to synchronize both Forms before displaying an iframe. It pre-fills only the logged-in player's name; the user selects the Calendar-derived Training or Spiele option inside Google Forms.

## Google Forms to Sheets

Both Forms write into linked Google Sheets. The response workbook is publicly published as ODS:

`https://docs.google.com/spreadsheets/d/e/2PACX-1vRJNo_nXAtAp7jSLmC535Xd2HRx3TTRXMen2_dj2hfZnRbuP3IRe9JSj5pED_XDyv9uPvJYVZkVnd2_/pub?output=ods`

Expected worksheets and identifying headers:

- Training responses: a sheet containing the `Training` header.
- Spiele responses: a sheet containing the `Spiele` header.

Do not depend on worksheet names such as `Form Responses 1`; the app deliberately discovers sheets by headers because Google can rename response sheets.

## Feedback aggregation rules

`api/feedback.mjs` fetches the ODS workbook and Calendar concurrently. Both requests use cache-busting and `no-store` because published Google Sheets responses can otherwise remain stale for several minutes.

All date and week calculations use `Europe/Berlin`. A week runs Monday through Sunday.

### Current-week Training overview

- Include every Calendar Training date in the current week, even with zero responses.
- Parse both legacy US dates such as `7/24/2026` and current labels such as `Freitag 24.07.2026`.
- Count at most one absence per player and Training date.
- Ignore rows without a valid Training date.
- Display the absent player names under each date.

### Current-week Spiele overview

- Include every detected Calendar game in the current week, even with zero responses.
- Parse the game and date from values formatted as `Gegner – DD.MM.YYYY`.
- For repeated submissions by the same player and game, the latest sheet row wins.
- Count only the exact values `Zusage` and `Absage`.
- For each player under Zusagen, count their current-week Training absences and display one `X` per absence in brackets.

### All-time Training table

- Use Training responses only; never include Spiele absences.
- Count unique player/date Training absences across the complete workbook.
- Start with the full `TEAM_NAMES` roster so players with zero absences are included.
- Sort by absence count ascending, then by German alphabetical player name.

## Roster maintenance

The feedback app has a `TEAM_NAMES` constant in `api/feedback.mjs`. The main app roster is in `h3_1/src/lib/users.ts`.

When adding, removing, or renaming a player, update both locations in the same change. Otherwise the feedback table can omit a player or treat a renamed player as a separate identity.

## Local development

```bash
bun install
bun x vercel dev
```

The local project is linked to the existing Vercel project through `.vercel/project.json`; `.vercel` and `node_modules` are ignored.

## Deployment

The Vercel project is connected to `Areo-RGB/feedback-weekly`.

- Pushes to `main` trigger production deployments automatically.
- Pull request branches receive preview deployments.
- The stable production alias is https://feedback-weekly.vercel.app.

After a data-flow change, verify both `/api/feedback` and the mobile UI. Check that:

1. The API returns fresh Sheets responses.
2. Current-week dates use Berlin time.
3. Training counts are deduplicated by player/date.
4. Spiele responses use the latest player/game response.
5. The all-time table is sorted ascending.
6. Both footer tabs work without horizontal overflow.

## Change safety

- Never commit service-account credentials.
- Keep the ODS and Calendar fetches server-side even though both sources are public.
- Preserve `Cache-Control: no-store` and request cache-busting for response freshness.
- Treat Form IDs, question entry IDs, sheet headers, and Calendar label conventions as external contracts.
- If a Form question type, title, or entry ID changes, update the main app synchronization and this feedback parser together.
