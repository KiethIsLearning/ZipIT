#!/usr/bin/env node
/* Playlist -> ZIP  (local backend, no npm packages)
   Needs: Node 18+, yt-dlp and ffmpeg on your PATH.
   Run:   node server/index.js   then open http://127.0.0.1:3000
   Only download music you have the right to. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawn, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1', PORT = Number(process.env.PORT || 3000), DL = path.resolve(process.env.DOWNLOAD_DIR || path.join(ROOT, 'downloads'));
const PUBLIC = path.join(ROOT, 'public');
const ORIGINS = [`http://${HOST}:${PORT}`];
const have = (c, a) => { const r = spawnSync(c, a, { stdio: 'ignore', timeout: 5000 }); return !r.error && r.status === 0; };
const clean = s => String(s ?? '').replace(/[\x00-\x1f\u007f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim();
const safe = s => {
  const original = clean(s).replace(/[<>:"/\\|?*%]/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '');
  const characters = Array.from(original);
  const suffix = characters.length > 80 ? `-${crypto.createHash('sha256').update(original).digest('hex').slice(0, 8)}` : '';
  const name = (characters.length > 80 ? characters.slice(0, 80 - suffix.length).join('') : original)
    .replace(/[ .]+$/g, '') + suffix || 'untitled';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
};
const TYPES = { '.mp3': 'audio/mpeg', '.flac': 'audio/flac' };
const BAD = ['live', 'cover', 'remix', 'karaoke', 'reaction', 'slowed', 'sped up', '8d', 'nightcore', 'instrumental', 'acoustic', 'reverb'];
const MAX_TRACKS = 1000, MAX_BODY_BYTES = 1024 * 1024, MAX_PROCESS_OUTPUT = 32 * 1024 * 1024;
const ALLOWED_HOSTS = ['spotify.com', 'deezer.com', 'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'soundcloud.com', 'bandcamp.com', 'mixcloud.com', 'apple.com'];
const SEARCH_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'soundcloud.com'];
const DIRECT_HOSTS = [...SEARCH_HOSTS, 'bandcamp.com', 'mixcloud.com'];
let downloadInProgress = false;
const json = (res, o, c = 200) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0, tooLarge = false;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
    } else if (!tooLarge) {
      chunks.push(chunk);
    }
  });
  req.on('end', () => tooLarge
    ? reject(Object.assign(Error('Request body is too large (maximum 1 MB).'), { statusCode: 413 }))
    : resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});
const isHost = (host, domains) => domains.some(domain => host === domain || host.endsWith(`.${domain}`));
const validateUrl = (raw, domains = ALLOWED_HOSTS) => {
  let url;
  try { url = new URL(raw); } catch { throw Error('Please provide a valid link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !isHost(url.hostname.toLowerCase(), domains)) {
    throw Error('That link is not from a supported music source.');
  }
  return url;
};
const sourceType = raw => {
  const host = validateUrl(raw).hostname.toLowerCase();
  if (isHost(host, ['spotify.com'])) return 'spotify';
  if (isHost(host, ['deezer.com'])) return 'deezer';
  if (isHost(host, ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'soundcloud.com', 'bandcamp.com', 'mixcloud.com'])) return 'direct';
  return 'metadata';
};
const playlistEntryUrl = entry => {
  if (typeof entry.webpage_url === 'string' && /^https:\/\//i.test(entry.webpage_url)) return entry.webpage_url;
  if (typeof entry.original_url === 'string' && /^https:\/\//i.test(entry.original_url)) return entry.original_url;
  if (typeof entry.url === 'string' && /^https:\/\//i.test(entry.url)) return entry.url;
  if (/^youtube/i.test(entry.ie_key || '') && entry.id) return `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`;
  return '';
};
const get = async (raw, asJson) => {
  const url = validateUrl(raw);
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000), redirect: 'manual' });
  } catch {
    throw Error(`Could not reach ${url.host}. Check your internet connection.`);
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw Error(`${url.host} redirected without a destination.`);
    const target = validateUrl(new URL(location, url).href);
    try {
      response = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(30000), redirect: 'error' });
    } catch {
      throw Error(`Could not reach ${target.host}. Check your internet connection.`);
    }
  }
  if (!response.ok) throw Error(`${url.host} returned ${response.status}`);
  if (Number(response.headers.get('content-length')) > 15 * 1024 * 1024) throw Error(`${url.host} returned a response that is too large.`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 15 * 1024 * 1024) throw Error(`${url.host} returned a response that is too large.`);
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return asJson ? JSON.parse(text) : text;
};
const norm = t => {
  if (!t || typeof t !== 'object') throw Error('Track data is invalid.');
  return {
    title: clean(t.title).slice(0, 500),
    artist: clean(t.artist).slice(0, 500),
    album: clean(t.album).slice(0, 500),
    duration: Number.isFinite(Number(t.duration)) && Number(t.duration) > 0 ? Number(t.duration) : null,
    direct: t.direct && typeof t.direct === 'object' && typeof t.direct.url === 'string'
      ? { ...t.direct, url: validateUrl(t.direct.url, DIRECT_HOSTS).href }
      : undefined
  };
};

function run(cmd, args, kids) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    kids.add(child);
    let out = '', err = '', settled = false, overflow = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      kids.delete(child);
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => child.kill(), 15 * 60 * 1000);
    child.stdout.on('data', chunk => {
      out += chunk.toString();
      if (out.length > MAX_PROCESS_OUTPUT) { overflow = true; child.kill(); }
    });
    child.stderr.on('data', chunk => { err = (err + chunk.toString()).slice(-64 * 1024); });
    child.on('error', error => finish({ code: -1, out, err: error.message }));
    child.on('close', code => finish({ code, out, err: overflow ? 'Process output exceeded the safety limit.' : err }));
  });
}
// YouTube now needs a JavaScript runtime for yt-dlp. Node is already installed, so let yt-dlp use it (if this yt-dlp supports the flag).
let jsRuntimeOptions;
const yt = (args, kids) => {
  if (!jsRuntimeOptions) {
    const help = spawnSync('yt-dlp', ['--help'], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 5000 });
    jsRuntimeOptions = (help.stdout || '').includes('--js-runtimes') ? ['--js-runtimes', 'node'] : [];
  }
  return run('yt-dlp', [...jsRuntimeOptions, '--socket-timeout', '20', ...args], kids);
};

// ---------- 1. Turn a link into a list of songs ----------
const find = (o, f) => { if (f(o)) return o; if (o && typeof o === 'object') for (const v of Object.values(o)) { const r = find(v, f); if (r) return r; } };
const parseTrackLines = input => input.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).slice(0, MAX_TRACKS).map(line => {
  const i = line.indexOf(' - ');
  return i > 0 ? { artist: clean(line.slice(0, i)).slice(0, 500), title: clean(line.slice(i + 3)).slice(0, 500) } : { artist: '', title: clean(line).slice(0, 500) };
});

async function spotify(u) {                       // public embed page: no login or API key needed
  const [, type, id] = u.match(/spotify\.com\/(?:intl-\w+\/)?(playlist|album|track)\/(\w+)/) || [];
  if (!id) throw Error('Unrecognised Spotify link');
  const m = (await get(`https://open.spotify.com/embed/${type}/${id}`)).match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!m) throw Error('Spotify changed its page format. Paste "Artist - Title" lines instead.');
  const j = JSON.parse(m[1]);
  const ent = j.props?.pageProps?.state?.data?.entity || find(j, o => o && (o.trackList || (o.artists && o.name))) || {};
  const tracks = (ent.trackList || [ent]).filter(t => t && (t.title || t.name)).slice(0, MAX_TRACKS).map(t => ({
    title: clean(t.title || t.name), artist: clean(t.subtitle || (t.artists || []).map(a => a.name).join(', ')), duration: (t.duration || 0) / 1000 || null }));
  return { name: ent.name || ent.title || 'Spotify playlist', tracks };
}

async function deezer(u) {
  const [, t, id] = u.match(/deezer\.com\/(?:\w+\/)?(playlist|album|track)\/(\d+)/) || [];
  if (!id) throw Error('Unrecognised Deezer link');
  const d = await get(`https://api.deezer.com/${t}/${id}`, true);
  if (d.error) throw Error(d.error.message || 'Deezer could not read that link.');
  const list = [];
  if (t === 'track') {
    list.push(d);
  } else {
    let next = `https://api.deezer.com/${t}/${id}/tracks?limit=100`;
    const visited = new Set();
    while (next && list.length < MAX_TRACKS) {
      if (visited.has(next)) throw Error('Deezer repeated a track-list page.');
      visited.add(next);
      const page = await get(next, true);
      if (page.error) throw Error(page.error.message || 'Deezer could not read that playlist.');
      if (!Array.isArray(page.data)) throw Error('Deezer returned an invalid track list.');
      list.push(...page.data.slice(0, MAX_TRACKS - list.length));
      next = typeof page.next === 'string' && list.length < MAX_TRACKS ? page.next : '';
    }
  }
  return { name: d.title || 'Deezer', tracks: list.map(x => ({ title: x.title, artist: x.artist?.name || '', album: x.album?.title || '', duration: x.duration })) };
}

async function direct(u, kids) {                  // YouTube, SoundCloud, Bandcamp, Mixcloud... are already sources
  const r = await yt(['-J', '--flat-playlist', '--playlist-end', String(MAX_TRACKS), '--no-warnings', u], kids);
  if (r.code) throw Error((r.err.trim().split('\n').pop() || 'Could not read that link').slice(0, 200));
  const j = JSON.parse(r.out);
  const tracks = [];
  const entries = Array.isArray(j.entries) ? j.entries : [j];
  for (const entry of entries.slice(0, MAX_TRACKS)) {
    if (!entry) continue;
    let url;
    try { url = validateUrl(playlistEntryUrl(entry), DIRECT_HOSTS).href; } catch { continue; }
    const full = clean(entry.title), i = full.indexOf(' - '), ch = clean(entry.channel || entry.uploader).replace(/ - Topic$/, '');
    tracks.push({
      title: i > 0 ? full.slice(i + 3) : full,
      artist: i > 0 ? full.slice(0, i) : ch,
      duration: entry.duration || null,
      direct: { url, title: full, channel: ch, duration: entry.duration || null, score: 0 }
    });
  }
  return { name: j.title || 'Playlist', tracks };
}

async function ld(u) {                            // best effort for Apple Music and other sites (page metadata)
  const html = await get(u), by = x => [].concat(x?.byArtist || []).map(a => a.name).join(', ');
  for (const m of html.matchAll(/<script[^>]*ld\+json[^>]*>(.*?)<\/script>/gs)) try {
    for (const o of [].concat(JSON.parse(m[1]))) if (Array.isArray(o.track))
      return { name: o.name, tracks: o.track.map(t => ({ title: clean(t.name), artist: by(t) || by(o) || clean(o.author?.name), album: o.name })) };
  } catch {}
  throw Error('Could not read songs from that site. Paste "Artist - Title" lines instead.');
}

async function resolve(input, kids) {
  const urls = input.match(/https?:\/\/[^\s<>"']+/g);
  if (!urls) return { name: '', tracks: parseTrackLines(input) };
  const out = { name: '', tracks: [] };
  for (const raw of urls.slice(0, MAX_TRACKS)) {
    const url = validateUrl(raw.replace(/[),.;!?]+$/g, ''));
    const type = sourceType(url.href);
    const r = type === 'spotify' ? await spotify(url.href) : type === 'deezer' ? await deezer(url.href)
      : type === 'direct' ? await direct(url.href, kids) : await ld(url.href);
    out.name = out.name || r.name;
    out.tracks.push(...r.tracks.slice(0, MAX_TRACKS - out.tracks.length));
    if (out.tracks.length >= MAX_TRACKS) break;
  }
  return out;
}

// ---------- 2. Find each song on YouTube / SoundCloud ----------
function scoreCandidate(track, candidate) {
  const title = clean(candidate.title).toLowerCase(), channel = clean(candidate.channel || candidate.uploader).toLowerCase();
  const duration = Number(candidate.duration) || null;
  const wantedTitle = clean(track.title).toLowerCase();
  const artist = clean(track.artist).split(/,|;/)[0].trim().toLowerCase();
  let score = duration && track.duration ? Math.abs(duration - track.duration) : 30;
  if (duration && track.duration && Math.abs(duration - track.duration) > 20) score += 100;
  score += BAD.filter(word => title.includes(word) && !wantedTitle.includes(word)).length * 25;
  if (channel.endsWith('- topic')) score -= 5;
  if (artist && (title + ' ' + channel).includes(artist)) score -= 3;
  return score;
}

async function candidates(t, site, kids) {
  if (t.direct) return [t.direct];
  const sc = site === 'soundcloud', q = `${t.artist} ${t.title}`.trim();
  const r = await yt([`${sc ? 'scsearch5' : 'ytsearch5'}:${q}${sc ? '' : ' audio'}`, '--flat-playlist', '--dump-json', '--no-warnings'], kids);
  if (r.code === -1) throw Error('Could not start yt-dlp. Is it installed and on your PATH?');
  return r.out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch {} }).filter(Boolean).map(e => {
    let url;
    try { url = validateUrl(e.url || `https://www.youtube.com/watch?v=${e.id}`, SEARCH_HOSTS).href; } catch { return null; }
    const d = Number(e.duration) || null;
    return { url, title: clean(e.title), channel: clean(e.channel || e.uploader), duration: d, score: scoreCandidate(t, e) };
  }).filter(Boolean).sort((a, b) => a.score - b.score);
}

async function match(b, { kids, out, dead }) {
  if (!Array.isArray(b.tracks) || b.tracks.length > MAX_TRACKS) throw Error(`A playlist can contain at most ${MAX_TRACKS} songs.`);
  const tracks = b.tracks.map(norm), site = b.site === 'soundcloud' ? 'soundcloud' : 'youtube';
  let n = 0;
  await Promise.all([1, 2, 3].map(async () => {
    while (!dead() && n < tracks.length) {
      const i = n++;
      try { out({ i, c: await candidates(tracks[i], site, kids) }); }
      catch (error) { out({ i, c: [], error: error.message }); }
    }
  }));
  out({ type: 'end' });
}

// ---------- 3. Download the chosen matches ----------
async function dl(b, { kids, out, dead }) {
  if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > MAX_TRACKS) throw Error(`Select between 1 and ${MAX_TRACKS} songs to download.`);
  if (b.format !== 'mp3' && b.format !== 'flac') throw Error('Choose MP3 or FLAC format.');
  const fmt = b.format, quality = Number.parseInt(b.quality, 10);
  const q = String(Math.min(320, Math.max(64, Number.isFinite(quality) ? quality : 192)));
  const seenIds = new Set();
  const items = b.items.map(item => {
    if (!item || !Number.isInteger(item.id) || item.id < 0 || item.id >= MAX_TRACKS || seenIds.has(item.id)) throw Error('Selected song data is invalid.');
    seenIds.add(item.id);
    const track = norm(item);
    return { ...track, id: item.id, url: validateUrl(item.url, DIRECT_HOSTS).href };
  });
  const dir = path.join(DL, safe(b.name || 'Playlist'));
  fs.mkdirSync(DL, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.realpathSync(dir).startsWith(fs.realpathSync(DL) + path.sep)) throw Error('Invalid download folder.');
  out({ type: 'folder', folder: path.basename(dir) });
  let ok = 0, failed = 0;
  for (let n = 0; n < items.length && !dead(); n++) {
    const x = items[n], t = norm(x), id = x.id;
    const stem = path.join(dir, `${String((+id || 0) + 1).padStart(2, '0')} - ${safe([t.artist, t.title].filter(Boolean).join(' - '))}`), file = `${stem}.${fmt}`;
    if (fs.existsSync(file)) { out({ id, status: 'skipped' }); ok++; continue; }
    out({ id, status: 'downloading' });
    // Work in a hidden temp folder so a half-finished file can never land in the ZIP or overwrite a saved song.
    const tmp = path.join(dir, `.tmp-${id}`), made = path.join(tmp, `tagged.${fmt}`);
    const meta = [`title=${t.title}`, `artist=${t.artist}`, `track=${(+id || 0) + 1}`, ...(t.album ? [`album=${t.album}`] : [])];
    let err = '';
    try {
      fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
      const r = await yt(['-x', '--audio-format', fmt, ...(fmt === 'mp3' ? ['--audio-quality', q + 'K'] : []), '--no-playlist', '--no-warnings',
        '-o', path.join(tmp, 'song.%(ext)s'), '--', x.url], kids);
      if (dead()) break;
      const src = path.join(tmp, `song.${fmt}`);
      if (r.code !== 0 || !fs.existsSync(src)) err = r.err.trim().split('\n').pop() || 'Download failed';
      else {   // write our own tags so they are always right, whatever yt-dlp did
        const g = await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-map', '0:a', '-map_metadata', '-1', '-c', 'copy',
          ...(fmt === 'mp3' ? ['-id3v2_version', '3'] : []), ...meta.flatMap(m => ['-metadata', m]), made], kids);
        if (dead()) break;
        if (g.code === 0 && fs.existsSync(made)) fs.renameSync(made, file); else err = 'Could not write tags: ' + g.err.trim().split('\n').pop();
      }
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
    if (!err && fs.existsSync(file)) { out({ id, status: 'done' }); ok++; }
    else { out({ id, status: 'failed', msg: err.slice(0, 140) || 'Download failed' }); failed++; }
  }
  out({ type: 'end', ok, failed });
}

// ---------- ZIP (store-only streaming writer) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
async function zipFolder(dir, res) {
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('.') && TYPES[path.extname(f)] && fs.lstatSync(path.join(dir, f)).isFile()).sort();
  if (!files.length) throw Error('No completed songs are available to ZIP.');
  if (files.length > 65535) throw Error('This ZIP format supports at most 65,535 files.');
  let expectedSize = 22 + files.length * 92;
  for (const file of files) {
    const nameLength = Buffer.byteLength(file);
    const size = fs.statSync(path.join(dir, file)).size;
    if (nameLength > 65535 || size > 0xffffffff) throw Error('A song exceeds the ZIP format limits.');
    expectedSize += 2 * nameLength + size;
  }
  if (expectedSize > 0xffffffff) throw Error('This playlist exceeds the 4 GB ZIP format limit.');
  const d = new Date(), central = [];
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': expectedSize,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(dir))}.zip`,
    'X-Content-Type-Options': 'nosniff'
  });
  let off = 0;
  const w = buf => new Promise(r => { off += buf.length; if (res.destroyed || res.write(buf)) r(); else { res.once('drain', r); res.once('close', r); } });
  for (const f of files) {
    if (res.destroyed) return;
    const name = Buffer.from(f), start = off, h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0808, 6); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt16LE(name.length, 26);
    await w(Buffer.concat([h, name]));
    let crc = 0xFFFFFFFF, size = 0;
    for await (const ch of fs.createReadStream(path.join(dir, f))) { for (let i = 0; i < ch.length; i++) crc = CRC[(crc ^ ch[i]) & 255] ^ (crc >>> 8); size += ch.length; if (size > 0xffffffff) throw Error('A song exceeds the ZIP format limits.'); await w(ch); }
    crc = (crc ^ 0xFFFFFFFF) >>> 0;
    const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(crc, 4); dd.writeUInt32LE(size, 8); dd.writeUInt32LE(size, 12);
    await w(dd); central.push({ name, crc, size, start });
  }
  const cd = off;
  for (const e of central) {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0808, 8); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24); c.writeUInt16LE(e.name.length, 28); c.writeUInt32LE(e.start, 42);
    await w(Buffer.concat([c, e.name]));
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10); end.writeUInt32LE(off - cd, 12); end.writeUInt32LE(cd, 16);
  await w(end); res.end();
}

// ---------- HTTP ----------
function stream(res, fn) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  const kids = new Set();
  let dead = false;
  res.on('close', () => { dead = true; kids.forEach(child => child.kill()); });
  const out = event => { if (!dead) res.write(JSON.stringify(event) + '\n'); };
  return fn({ kids, out, dead: () => dead })
    .catch(error => out({ type: 'error', msg: error.message }))
    .finally(() => res.end());
}

function startServer() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw Error('PORT must be an integer between 1 and 65535.');
  }
  fs.mkdirSync(DL, { recursive: true });
  const server = http.createServer(async (req, res) => {
    if (req.headers.host !== `${HOST}:${PORT}`) { res.writeHead(403); return res.end(); }
    if ((req.headers.origin && !ORIGINS.includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403); return res.end();
    }
    let url;
    try { url = new URL(req.url, `http://${HOST}:${PORT}`); }
    catch { res.writeHead(400); return res.end(); }
    const route = url.pathname;
    try {
      if (req.method === 'POST') {
        let body;
        try { body = JSON.parse(await readBody(req)); }
        catch (error) { return json(res, { error: error.message === 'Unexpected end of JSON input' ? 'Bad request' : error.message }, error.statusCode || 400); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, { error: 'Bad request' }, 400);
        if (route === '/api/resolve') {
          if (typeof body.input !== 'string' || !body.input.trim()) return json(res, { error: 'Enter a link or at least one song.' }, 400);
          const children = new Set();
          res.on('close', () => children.forEach(child => child.kill()));
          try {
            const result = await resolve(body.input.slice(0, MAX_BODY_BYTES), children);
            if (!result.tracks.length) throw Error('No songs found. Check the input and try again.');
            return json(res, { name: safe(result.name || 'Playlist'), tracks: result.tracks.slice(0, MAX_TRACKS).map(norm) });
          } catch (error) {
            return json(res, { error: error.message }, 422);
          }
        }
        if (route === '/api/match') return stream(res, options => match(body, options));
        if (route === '/api/download') {
          if (downloadInProgress) return json(res, { error: 'A download is already running. Wait for it to finish or cancel it first.' }, 409);
          downloadInProgress = true;
          return stream(res, async options => {
            try { await dl(body, options); }
            finally { downloadInProgress = false; }
          });
        }
        res.writeHead(404); return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
      if (route === '/api/status') {
        return json(res, { node: process.versions.node, ytdlp: have('yt-dlp', ['--version']), ffmpeg: have('ffmpeg', ['-version']) });
      }
      if (route === '/api/zip') {
        const root = fs.realpathSync(DL);
        const dir = path.join(root, safe(url.searchParams.get('folder')));
        if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory() || !fs.realpathSync(dir).startsWith(root + path.sep)) {
          res.writeHead(404); return res.end('No songs saved for this playlist yet.');
        }
        return await zipFolder(dir, res);
      }
      const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
      if (files[route]) {
        const [filename, contentType] = files[route];
        res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
        return req.method === 'HEAD' ? res.end() : res.end(fs.readFileSync(path.join(PUBLIC, filename)));
      }
      res.writeHead(404); res.end();
    } catch (error) {
      if (!res.headersSent) json(res, { error: error.message }, 500);
      else res.destroy(error);
    }
  });
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other app or start with a different PORT value.`);
    } else {
      console.error(`Could not start the local server: ${error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Playlist -> ZIP running at http://${HOST}:${PORT}\nSongs are saved in: ${DL}`);
    if (!have('yt-dlp', ['--version'])) console.warn('Missing yt-dlp. Run "npm run doctor" for installation instructions.');
    if (!have('ffmpeg', ['-version'])) console.warn('Missing ffmpeg. Run "npm run doctor" for installation instructions.');
    if (!process.env.NO_OPEN) {
      const address = `http://${HOST}:${PORT}`;
      const [command, ...args] = process.platform === 'win32' ? ['cmd', '/c', 'start', '', address] : process.platform === 'darwin' ? ['open', address] : ['xdg-open', address];
      const browser = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
      browser.on('error', error => console.warn(`Could not open a browser automatically: ${error.message}. Visit ${address}`));
      browser.unref();
    }
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { clean, safe, validateUrl, sourceType, playlistEntryUrl, parseTrackLines, scoreCandidate, norm, zipFolder, startServer };
