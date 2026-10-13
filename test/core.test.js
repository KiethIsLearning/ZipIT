'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { parseTrackLines, playlistEntryUrl, safe, scoreCandidate, sourceType, validateUrl, zipFolder } = require('../server');

test('parses song lines with punctuation and ignores comments and blank lines', () => {
  assert.deepEqual(parseTrackLines('\n# playlist\nBjörk - Jóga\nArtist - Title - Part 2\nUnknown title\n'), [
    { artist: 'Björk', title: 'Jóga' },
    { artist: 'Artist', title: 'Title - Part 2' },
    { artist: '', title: 'Unknown title' }
  ]);
});

test('caps parsed playlist size at 1,000 tracks', () => {
  const songs = Array.from({ length: 1001 }, (_, index) => `Artist - Song ${index}`).join('\n');
  assert.equal(parseTrackLines(songs).length, 1000);
});

test('accepts only HTTPS links from supported, boundary-matched domains', () => {
  assert.equal(validateUrl('https://open.spotify.com/playlist/example').hostname, 'open.spotify.com');
  assert.equal(sourceType('https://open.spotify.com/playlist/example'), 'spotify');
  assert.equal(sourceType('https://m.youtube.com/playlist?list=example'), 'direct');
  assert.equal(sourceType('https://music.apple.com/us/album/example'), 'metadata');
  assert.equal(playlistEntryUrl({ webpage_url: 'https://www.youtube.com/watch?v=canonical', url: 'https://cdn.invalid/media' }), 'https://www.youtube.com/watch?v=canonical');
  assert.equal(playlistEntryUrl({ ie_key: 'Youtube', id: 'video-id' }), 'https://www.youtube.com/watch?v=video-id');
  assert.throws(() => validateUrl('https://youtube.com.attacker.invalid/watch?v=x'));
  assert.throws(() => sourceType('https://attacker.invalid/playlist'));
  assert.throws(() => validateUrl('http://youtube.com/watch?v=x'));
  assert.throws(() => validateUrl('https://user:pass@youtube.com/watch?v=x'));
  assert.throws(() => validateUrl('http://127.0.0.1:3000/'));
});

test('creates safe bounded file-name segments while retaining Unicode', () => {
  assert.equal(safe('../Björk: Jóga?*'), 'Björk Jóga');
  assert.equal(Array.from(safe('x'.repeat(500))).length, 80);
  assert.notEqual(safe('x'.repeat(500) + 'a'), safe('x'.repeat(500) + 'b'));
  assert.equal(safe('...'), 'untitled');
  assert.equal(safe('CON'), '_CON');
});

test('scores exact artist matches and penalizes unwanted versions', () => {
  const track = { title: 'Song', artist: 'Artist', duration: 200 };
  const studio = scoreCandidate(track, { title: 'Song', channel: 'Artist - Topic', duration: 200 });
  const cover = scoreCandidate(track, { title: 'Song live cover', channel: 'Someone', duration: 240 });
  assert.ok(studio < cover);
});

test('writes a valid store-only ZIP with UTF-8 filenames and correct CRCs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'playlist-to-zip-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const entries = [
    ['01 - Beyoncé - Halo.mp3', Buffer.from('audio bytes one')],
    ['02 - Björk - Jóga.flac', Buffer.from('audio bytes two')]
  ];
  for (const [name, content] of entries) fs.writeFileSync(path.join(directory, name), content);
  fs.writeFileSync(path.join(directory, '.tmp-interrupted.mp3'), 'must not be included');

  const chunks = [];
  const response = {
    destroyed: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk) { chunks.push(Buffer.from(chunk)); return true; },
    end(chunk) { if (chunk) chunks.push(Buffer.from(chunk)); this.ended = true; }
  };
  await zipFolder(directory, response);
  const zip = Buffer.concat(chunks);
  assert.equal(response.status, 200);
  assert.equal(Number(response.headers['Content-Length']), zip.length);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);

  let offset = 0;
  for (const [name, content] of entries) {
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    assert.equal(zip.readUInt16LE(offset + 8), 0);
    const nameLength = zip.readUInt16LE(offset + 26);
    const storedName = zip.toString('utf8', offset + 30, offset + 30 + nameLength);
    assert.equal(storedName, name);
    const contentOffset = offset + 30 + nameLength;
    assert.deepEqual(zip.subarray(contentOffset, contentOffset + content.length), content);
    const descriptor = contentOffset + content.length;
    assert.equal(zip.readUInt32LE(descriptor), 0x08074b50);
    assert.equal(zip.readUInt32LE(descriptor + 4), crc32(content));
    offset = descriptor + 16;
  }
  assert.equal(zip.readUInt32LE(offset), 0x02014b50);
  assert.equal(response.ended, true);
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
