import * as XLSX from 'xlsx';

const FEEDBACK_ODS_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRJNo_nXAtAp7jSLmC535Xd2HRx3TTRXMen2_dj2hfZnRbuP3IRe9JSj5pED_XDyv9uPvJYVZkVnd2_/pub?output=ods';
const CALENDAR_ICS_URL = 'https://calendar.google.com/calendar/ical/09d3a4912c1f0189356e2efffafd8eedafbabedb79b3a6a4080ed47dadcb6626%40group.calendar.google.com/public/basic.ics';
const DAY_IN_MS = 86_400_000;
const TEAM_NAMES = [
  'Alex',
  'Arturo',
  'Arvid',
  'Finley',
  'Jakob',
  'Lasse',
  'Lennox',
  'Levi',
  'Lion',
  'Lionel',
  'Milan',
  'Paul',
  'Peter',
  'Silas',
  'Tayo',
  'Tommy',
];


const berlinDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const displayDateFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const shortDateFormatter = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function dateFromIso(value) {
  return new Date(`${value}T00:00:00Z`);
}

function isoFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function getBerlinToday() {
  const parts = berlinDateFormatter.formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getCurrentWeek(today) {
  const date = dateFromIso(today);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = new Date(date.getTime() - (mondayOffset * DAY_IN_MS));
  const end = new Date(start.getTime() + (6 * DAY_IN_MS));

  return {
    start: isoFromDate(start),
    end: isoFromDate(end),
    label: `${shortDateFormatter.format(start)} – ${shortDateFormatter.format(end)}`,
  };
}

function parseResponseDate(value) {
  const text = String(value ?? '').trim();
  let match = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  }

  return null;
}

function getProperty(lines, name) {
  const line = lines.find((candidate) => candidate.startsWith(`${name}:`) || candidate.startsWith(`${name};`));
  return line?.slice(line.indexOf(':') + 1) ?? '';
}

function parseCalendarDate(value) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/);
  if (!match) return null;

  if (match[7] && match[4] && match[5]) {
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}Z`);
    const parts = berlinDateFormatter.formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseCalendar(ics, week) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const events = [...unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/g)]
    .map((match) => match[1].split(/\r?\n/))
    .filter((lines) => getProperty(lines, 'STATUS').toUpperCase() !== 'CANCELLED');
  const trainingDates = new Set();
  const games = new Map();

  for (const lines of events) {
    const summary = getProperty(lines, 'SUMMARY').replace(/\\,/g, ',').trim();
    const start = parseCalendarDate(getProperty(lines, 'DTSTART'));
    if (!start) continue;

    if (summary.toLowerCase() === 'training') {
      const recurrence = getProperty(lines, 'RRULE');
      if (!recurrence) {
        if (start >= week.start && start <= week.end) trainingDates.add(start);
        continue;
      }

      const rule = Object.fromEntries(recurrence.split(';').map((part) => part.split('=', 2)));
      if (rule.FREQ !== 'WEEKLY') continue;
      const interval = Number.parseInt(rule.INTERVAL ?? '1', 10);
      const occurrence = dateFromIso(start);
      while (isoFromDate(occurrence) < week.start) occurrence.setUTCDate(occurrence.getUTCDate() + (7 * interval));
      const occurrenceDate = isoFromDate(occurrence);
      if (occurrenceDate <= week.end) trainingDates.add(occurrenceDate);
      continue;
    }

    if ((/(^|\W)spiele?(\W|$)/i.test(summary) || /\s[-–—]\s/.test(summary)) && start >= week.start && start <= week.end) {
      games.set(`${start}|${summary}`, { date: start, summary });
    }
  }

  return {
    trainingDates: [...trainingDates].sort(),
    games: [...games.values()].sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary)),
  };
}

function rowsFromSheet(workbook, sheetName) {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: '',
  });
}

function findSheet(workbook, expectedHeader) {
  return workbook.SheetNames.find((sheetName) => {
    const [headers = []] = rowsFromSheet(workbook, sheetName);
    return headers.some((header) => String(header).trim() === expectedHeader);
  });
}

function rowsAsObjects(rows) {
  const [headers = [], ...values] = rows;
  return values.map((row) => Object.fromEntries(headers.map((header, index) => [String(header).trim(), row[index] ?? ''])));
}

function buildTrainingSummary(rows, scheduledDates, week) {
  const latestByPlayerAndDate = new Map();
  for (const row of rows) {
    const date = parseResponseDate(row.Training);
    const name = String(row.Name ?? '').trim();
    if (!date || !name || date < week.start || date > week.end) continue;
    latestByPlayerAndDate.set(`${name}|${date}`, { date, name });
  }

  const namesByDate = new Map(scheduledDates.map((date) => [date, []]));
  for (const { date, name } of latestByPlayerAndDate.values()) {
    if (!namesByDate.has(date)) namesByDate.set(date, []);
    namesByDate.get(date).push(name);
  }

  return [...namesByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, names]) => ({
      date,
      label: displayDateFormatter.format(dateFromIso(date)),
      absagen: names.length,
      names: names.sort((a, b) => a.localeCompare(b, 'de')),
    }));
}

function buildTrainingTable(rows) {
  const counts = new Map(TEAM_NAMES.map((name) => [name, 0]));
  const countedAbsences = new Set();

  for (const row of rows) {
    const date = parseResponseDate(row.Training);
    const name = String(row.Name ?? '').trim();
    const key = `${name}|${date}`;
    if (!date || !counts.has(name) || countedAbsences.has(key)) continue;

    countedAbsences.add(key);
    counts.set(name, counts.get(name) + 1);
  }

  return [...counts.entries()]
    .map(([name, absagen]) => ({ name, absagen }))
    .sort((a, b) => a.absagen - b.absagen || a.name.localeCompare(b.name, 'de'));
}


function parseGameChoice(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(.*?)\s+–\s+(\d{1,2}\.\d{1,2}\.\d{4})$/);
  if (!match) return null;
  const date = parseResponseDate(match[2]);
  return date ? { date, summary: match[1].trim(), value: text } : null;
}

function buildGameSummary(rows, scheduledGames, week) {
  const latestByPlayerAndGame = new Map();
  for (const row of rows) {
    const game = parseGameChoice(row.Spiele);
    const name = String(row.Name ?? '').trim();
    const attendance = String(row.Anwesenheit ?? '').trim();
    if (!game || !name || game.date < week.start || game.date > week.end || !['Zusage', 'Absage'].includes(attendance)) continue;
    latestByPlayerAndGame.set(`${name}|${game.value}`, { ...game, name, attendance });
  }

  const summaries = new Map(scheduledGames.map((game) => [`${game.date}|${game.summary}`, {
    date: game.date,
    summary: game.summary,
    zusagenNames: [],
    absagenNames: [],
  }]));

  for (const response of latestByPlayerAndGame.values()) {
    const key = `${response.date}|${response.summary}`;
    if (!summaries.has(key)) {
      summaries.set(key, { date: response.date, summary: response.summary, zusagenNames: [], absagenNames: [] });
    }
    summaries.get(key)[response.attendance === 'Zusage' ? 'zusagenNames' : 'absagenNames'].push(response.name);
  }

  return [...summaries.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary))
    .map((game) => ({
      ...game,
      label: `${game.summary} · ${shortDateFormatter.format(dateFromIso(game.date))}`,
      zusagen: game.zusagenNames.length,
      absagen: game.absagenNames.length,
      zusagenNames: game.zusagenNames.sort((a, b) => a.localeCompare(b, 'de')),
      absagenNames: game.absagenNames.sort((a, b) => a.localeCompare(b, 'de')),
    }));
}

export default async function handler(_request, response) {
  try {
    const cacheBuster = Date.now();
    const [odsResponse, calendarResponse] = await Promise.all([
      fetch(`${FEEDBACK_ODS_URL}&cb=${cacheBuster}`, { cache: 'no-store' }),
      fetch(`${CALENDAR_ICS_URL}?cb=${cacheBuster}`, { cache: 'no-store' }),
    ]);
    if (!odsResponse.ok || !calendarResponse.ok) {
      throw new Error(`Source unavailable: ODS ${odsResponse.status}, calendar ${calendarResponse.status}`);
    }

    const workbook = XLSX.read(Buffer.from(await odsResponse.arrayBuffer()), { type: 'buffer' });
    const trainingSheet = findSheet(workbook, 'Training');
    const gameSheet = findSheet(workbook, 'Spiele');
    if (!trainingSheet || !gameSheet) throw new Error('Feedback worksheets not found');

    const week = getCurrentWeek(getBerlinToday());
    const calendar = parseCalendar(await calendarResponse.text(), week);
    const trainingRows = rowsAsObjects(rowsFromSheet(workbook, trainingSheet));
    const gameRows = rowsAsObjects(rowsFromSheet(workbook, gameSheet));
    const training = buildTrainingSummary(trainingRows, calendar.trainingDates, week);
    const trainingAbsencesByPlayer = new Map();
    for (const session of training) {
      for (const name of session.names) {
        trainingAbsencesByPlayer.set(name, (trainingAbsencesByPlayer.get(name) ?? 0) + 1);
      }
    }
    const games = buildGameSummary(gameRows, calendar.games, week).map((game) => ({
      ...game,
      zusagenPlayers: game.zusagenNames.map((name) => ({
        name,
        trainingAbsences: trainingAbsencesByPlayer.get(name) ?? 0,
      })),
    }));
    const trainingTable = buildTrainingTable(trainingRows);


    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.status(200).json({
      week,
      training,
      games,
      trainingTable,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    response.status(502).json({ error: 'Feedback konnte nicht geladen werden.' });
  }
}
