const ui = {
  banner: document.getElementById('banner'),
  disc: document.getElementById('disc'),
  find: document.getElementById('find'),
  stop: document.getElementById('stop'),
  dl: document.getElementById('dl'),
  in: document.getElementById('in'),
  hint: document.getElementById('hint'),
  msg: document.getElementById('msg'),
  res: document.getElementById('res'),
  rows: document.getElementById('rows'),
  name: document.getElementById('name'),
  cnt: document.getElementById('cnt'),
  all: document.getElementById('all'),
  none: document.getElementById('none'),
  dock: document.getElementById('dock'),
  sel: document.getElementById('sel'),
  bar: document.getElementById('bar'),
  zip: document.getElementById('zip')
};

const state = {
  opt: { site: 'youtube', fmt: 'mp3', mode: 'review' },
  name: '',
  rows: [],
  folder: '',
  saved: 0,
  ctl: null,
  working: false
};

const post = (route, payload, signal) =>
  fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

const makeElement = (tagName, className, text) => {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
};

const setMessage = (text = '', isError = false) => {
  ui.msg.textContent = text;
  ui.msg.className = isError ? 'err' : '';
};

const formatDuration = (seconds) => {
  if (!seconds) return '';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

const saveOptions = () => {
  try {
    localStorage.plzip = JSON.stringify(state.opt);
  } catch (error) {
    // ignore option persistence errors
  }
};

const setBusy = (busy) => {
  state.working = busy;
  ui.disc.classList.toggle('spin', busy);
  ui.find.textContent = busy ? 'Cancel' : 'Find songs';
  ui.stop.hidden = !busy;
  ui.dl.hidden = busy;
};

const updateFormatHint = () => {
  ui.hint.hidden = state.opt.fmt !== 'flac';
};

const initializeSegmentGroups = () => {
  document.querySelectorAll('.seg').forEach((group) => {
    const pick = (value) => {
      const selectedButton = [...group.children].find((button) => button.dataset.v === value) || group.children[0];
      [...group.children].forEach((button) => button.classList.toggle('on', button === selectedButton));
      state.opt[group.id] = selectedButton.dataset.v;

      if (group.id === 'fmt') {
        updateFormatHint();
      }
    };

    pick(state.opt[group.id]);

    group.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      pick(button.dataset.v);
      saveOptions();
    });
  });
};

const streamEvents = async (response, onEvent) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    lines.filter(Boolean).forEach((line) => onEvent(JSON.parse(line)));
  }
};

const updateSelectionInfo = () => {
  const selectedCount = state.rows.filter((row) => row.on).length;
  ui.cnt.textContent = `${selectedCount}/${state.rows.length} selected`;
  ui.sel.textContent = `${selectedCount} selected`;
  ui.dl.disabled = selectedCount === 0;
};

const updateRow = (index) => {
  const row = state.rows[index];
  if (!row) return;

  const rowElement = document.getElementById(`r${index}`);
  if (!rowElement) return;

  const [checkbox, info, select, link, status] = rowElement.children;
  const candidate = row.c[row.k];
  const matchInfo = info.children[2];

  checkbox.checked = row.on;
  checkbox.disabled = !candidate;
  matchInfo.textContent = candidate ? [candidate.title, candidate.channel, formatDuration(candidate.duration)].filter(Boolean).join(' · ') : 'No match found';
  matchInfo.className = 'm' + (!candidate || candidate.score >= 100 ? ' warn' : '');

  if (row.c.length > 1 && !select.options.length) {
    row.c.forEach((option, optionIndex) => {
      select.add(new Option(`${option.title} - ${option.channel} ${formatDuration(option.duration)}`, String(optionIndex)));
    });
  }

  select.hidden = row.c.length < 2;
  select.value = String(row.k);
  link.hidden = !candidate;

  if (candidate) {
    link.href = candidate.url;
  }

  updateSelectionInfo();
};

const renderRows = () => {
  ui.res.hidden = false;
  ui.dock.hidden = false;
  ui.name.value = state.name;
  ui.rows.textContent = '';

  state.rows.forEach((row, index) => {
    const item = makeElement('li');
    item.id = `r${index}`;

    const checkbox = makeElement('input');
    checkbox.type = 'checkbox';
    checkbox.disabled = true;
    checkbox.addEventListener('change', () => {
      row.on = checkbox.checked;
      updateSelectionInfo();
    });

    const info = makeElement('div', 't');
    info.append(
      makeElement('b', '', row.title),
      makeElement('small', '', [row.artist, formatDuration(row.duration)].filter(Boolean).join(' · ')),
      makeElement('small', 'm', 'Searching...')
    );

    const select = makeElement('select');
    select.hidden = true;
    select.addEventListener('change', () => {
      row.k = Number(select.value);
      row.on = true;
      updateRow(index);
    });

    const listenLink = makeElement('a', 'ls', 'Listen ↗');
    listenLink.target = '_blank';
    listenLink.rel = 'noopener';
    listenLink.hidden = true;

    item.append(checkbox, info, select, listenLink, makeElement('div', 'st'));
    ui.rows.append(item);
  });

  updateSelectionInfo();
};

const updateZipButton = () => {
  const zipLink = ui.zip;
  const showLink = !!(state.folder && state.saved);

  zipLink.hidden = !showLink;
  if (!showLink) return;

  zipLink.href = `/api/zip?folder=${encodeURIComponent(state.folder)}`;
  zipLink.textContent = `⬇ ZIP (${state.saved})`;
};

const setRowStatus = (rowId, status, message) => {
  const rowState = document.getElementById(`r${rowId}`)?.lastChild;
  if (!rowState) return;

  rowState.className = `st ${status}`;
  const labels = {
    downloading: 'Downloading...',
    done: 'Saved',
    skipped: 'Already saved',
    failed: `Failed${message ? `: ${message}` : ''}`
  };

  rowState.textContent = labels[status] || '';
};

const loadStatus = () => {
  fetch('/api/status')
    .then((response) => response.json())
    .then((status) => {
      const missing = [!status.ytdlp && 'yt-dlp', !status.ffmpeg && 'ffmpeg'].filter(Boolean);
      if (missing.length) {
        ui.banner.hidden = false;
        ui.banner.textContent = `Missing on your PATH: ${missing.join(', ')}. Install it and restart the server.`;
      }
    })
    .catch(() => {});
};

ui.in.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !state.working) {
    ui.find.click();
  }
});

ui.name.addEventListener('input', (event) => {
  state.name = event.target.value;
  state.folder = '';
  updateZipButton();
});

ui.all.addEventListener('click', (event) => {
  event.preventDefault();
  state.rows.forEach((row, index) => {
    row.on = !!row.c[row.k];
    updateRow(index);
  });
});

ui.none.addEventListener('click', (event) => {
  event.preventDefault();
  state.rows.forEach((row, index) => {
    row.on = false;
    updateRow(index);
  });
});

ui.find.addEventListener('click', async () => {
  if (state.working) {
    return state.ctl.abort();
  }

  const input = ui.in.value.trim();
  if (!input) return;

  state.ctl = new AbortController();
  setBusy(true);
  setMessage('Reading your link...');
  ui.res.hidden = true;
  ui.zip.hidden = true;

  try {
    let response = await post('/api/resolve', { input }, state.ctl.signal);
    const payload = await response.json();

    if (!response.ok) throw new Error(payload.error);

    state.name = payload.name || `Playlist ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-')}`;
    state.rows = payload.tracks.map((track) => ({ ...track, c: [], k: 0, on: false }));
    state.folder = '';
    state.saved = 0;
    renderRows();

    setMessage(`Finding ${state.rows.length} songs on ${state.opt.site === 'youtube' ? 'YouTube' : 'SoundCloud'}...`);

    response = await post('/api/match', { tracks: payload.tracks, site: state.opt.site }, state.ctl.signal);
    await streamEvents(response, (event) => {
      if (event.type === 'error') throw new Error(event.msg);
      if (event.i != null) {
        const row = state.rows[event.i];
        row.c = event.c;
        row.on = !!event.c[0] && event.c[0].score < 100;
        updateRow(event.i);
      }
    });

    const weakMatches = state.rows.filter((row) => !row.on).length;
    setMessage(
      state.opt.mode === 'auto'
        ? 'Downloading automatically...'
        : `Check the matches below${weakMatches ? ` (${weakMatches} need a look)` : ''}, then press Download.`
    );

    if (state.opt.mode === 'auto') {
      await downloadSelected();
    }
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    setMessage(isAbort ? 'Cancelled.' : error.message, !isAbort);
  }

  setBusy(false);
  updateZipButton();
});

const downloadSelected = async () => {
  const items = state.rows
    .map((row, index) => ({
      id: index,
      title: row.title,
      artist: row.artist,
      album: row.album || '',
      url: row.c[row.k]?.url
    }))
    .filter((item, index) => state.rows[index].on && item.url);

  if (!items.length) return;

  if (!state.working) {
    state.ctl = new AbortController();
    setBusy(true);
  }

  const bar = ui.bar;
  bar.max = items.length;
  bar.value = 0;
  state.saved = 0;
  ui.zip.hidden = true;
  let finished = false;

  state.rows.forEach((_, index) => setRowStatus(index, ''));

  try {
    const response = await post('/api/download', { name: state.name, items, format: state.opt.fmt, quality: 192 }, state.ctl.signal);
    if (!response.ok) {
      throw new Error(await response.text());
    }

    await streamEvents(response, (event) => {
      if (event.type === 'folder') {
        state.folder = event.folder;
      } else if (event.type === 'error') {
        throw new Error(event.msg);
      } else if (event.type === 'end') {
        finished = true;
        setMessage(`Finished: ${event.ok} saved, ${event.failed} failed.`);
      } else {
        setRowStatus(event.id, event.status, event.msg);

        if (event.status === 'done' || event.status === 'skipped') {
          state.saved += 1;
          updateZipButton();
        }

        if (['done', 'skipped', 'failed'].includes(event.status)) {
          bar.value += 1;
        }
      }
    });
  } catch (error) {
    const isAbort = error.name === 'AbortError';
    setMessage(isAbort ? 'Cancelled. Songs already saved can still be zipped.' : error.message, !isAbort);
  }

  setBusy(false);
  updateZipButton();

  if (finished && state.saved) {
    window.location.href = ui.zip.href;
  }
};

ui.dl.addEventListener('click', downloadSelected);
ui.stop.addEventListener('click', () => {
  if (state.ctl) {
    state.ctl.abort();
  }
});

try {
  Object.assign(state.opt, JSON.parse(localStorage.plzip || '{}'));
} catch (error) {
  // ignore option parsing errors
}

initializeSegmentGroups();
updateFormatHint();
loadStatus();
