const statusElement = document.querySelector('#status');
const dashboardElement = document.querySelector('#dashboard');
const weekLabelElement = document.querySelector('#week-label');
const trainingListElement = document.querySelector('#training-list');
const trainingTotalElement = document.querySelector('#training-total');
const gamesListElement = document.querySelector('#games-list');
const updatedAtElement = document.querySelector('#updated-at');
const refreshButton = document.querySelector('#refresh-button');
const overviewViewElement = document.querySelector('#overview-view');
const tableViewElement = document.querySelector('#table-view');
const trainingTableBodyElement = document.querySelector('#training-table-body');
const navItems = [...document.querySelectorAll('.nav-item')];

function createNameList(names) {
  if (names.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'no-names';
    empty.textContent = 'Keine Rückmeldungen';
    return empty;
  }

  const list = document.createElement('ul');
  list.className = 'names';
  for (const name of names) {
    const item = document.createElement('li');
    item.className = 'name-chip';
    item.textContent = name;
    list.append(item);
  }
  return list;
}

function renderTraining(training) {
  trainingListElement.replaceChildren();
  const total = training.reduce((sum, item) => sum + item.absagen, 0);
  trainingTotalElement.textContent = `${total} gesamt`;

  if (training.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Kein Training in dieser Woche.';
    trainingListElement.append(empty);
    return;
  }

  for (const item of training) {
    const card = document.createElement('article');
    card.className = 'card';

    const top = document.createElement('div');
    top.className = 'card-top';
    const label = document.createElement('h3');
    label.className = 'event-label';
    label.textContent = item.label;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = item.absagen;
    count.setAttribute('aria-label', `${item.absagen} Absagen`);
    top.append(label, count);

    card.append(top, createNameList(item.names));
    trainingListElement.append(card);
  }
}

function createRoster(labelText, names) {
  const group = document.createElement('div');
  group.className = 'roster-group';
  const label = document.createElement('p');
  label.className = 'roster-label';
  label.textContent = labelText;
  group.append(label, createNameList(names));
  return group;
}

function renderGames(games) {
  gamesListElement.replaceChildren();
  if (games.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Kein Spiel in dieser Woche.';
    gamesListElement.append(empty);
    return;
  }

  for (const game of games) {
    const card = document.createElement('article');
    card.className = 'card';
    const label = document.createElement('h3');
    label.className = 'event-label';
    label.textContent = game.label;

    const counts = document.createElement('div');
    counts.className = 'game-counts';
    for (const [className, value, text] of [
      ['zusage', game.zusagen, 'Zusagen'],
      ['absage', game.absagen, 'Absagen'],
    ]) {
      const stat = document.createElement('div');
      stat.className = `game-stat ${className}`;
      const number = document.createElement('strong');
      number.textContent = value;
      const caption = document.createElement('span');
      caption.textContent = text;
      stat.append(number, caption);
      counts.append(stat);
    }

    const zusagenNames = (game.zusagenPlayers ?? game.zusagenNames.map((name) => ({
      name,
      trainingAbsences: 0,
    }))).map(({ name, trainingAbsences }) => (
      trainingAbsences > 0
        ? `${name} [${Array(trainingAbsences).fill('X').join(' ')}]`
        : name
    ));

    card.append(
      label,
      counts,
      createRoster('Zusagen', zusagenNames),
      createRoster('Absagen', game.absagenNames),
    );
    gamesListElement.append(card);
  }
}

function renderTrainingTable(rows) {
  trainingTableBodyElement.replaceChildren();

  for (const row of rows) {
    const tableRow = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.textContent = row.name;
    const countCell = document.createElement('td');
    const count = document.createElement('span');
    count.className = 'table-count';
    count.textContent = row.absagen;
    count.setAttribute('aria-label', `${row.absagen} Training-Absagen`);
    countCell.append(count);
    tableRow.append(nameCell, countCell);
    trainingTableBodyElement.append(tableRow);
  }
}

function showView(view) {
  const showOverview = view === 'overview';
  overviewViewElement.hidden = !showOverview;
  tableViewElement.hidden = showOverview;
  weekLabelElement.textContent = showOverview
    ? weekLabelElement.dataset.overviewLabel
    : 'Alle erfassten Trainingstermine';

  for (const item of navItems) {
    const active = item.dataset.view === view;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}


async function loadFeedback() {
  refreshButton.disabled = true;
  statusElement.hidden = false;
  statusElement.classList.remove('error');
  statusElement.textContent = 'Feedback wird geladen…';

  try {
    const response = await fetch('/api/feedback', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Feedback request failed: ${response.status}`);
    const data = await response.json();

    weekLabelElement.dataset.overviewLabel = data.week.label;
    weekLabelElement.textContent = tableViewElement.hidden
      ? data.week.label
      : 'Alle erfassten Trainingstermine';
    renderTraining(data.training);
    renderGames(data.games);
    renderTrainingTable(data.trainingTable);
    updatedAtElement.textContent = `Stand: ${new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Berlin',
    }).format(new Date(data.updatedAt))}`;

    statusElement.hidden = true;
    dashboardElement.hidden = false;
  } catch (error) {
    console.error(error);
    dashboardElement.hidden = true;
    statusElement.hidden = false;
    statusElement.classList.add('error');
    statusElement.textContent = 'Feedback konnte nicht geladen werden.';
  } finally {
    refreshButton.disabled = false;
  }
}

for (const item of navItems) {
  item.addEventListener('click', () => showView(item.dataset.view));
}

refreshButton.addEventListener('click', loadFeedback);
loadFeedback();
window.setInterval(() => {
  if (!document.hidden) {
    void loadFeedback();
  }
}, 60_000);
