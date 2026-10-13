# ZipIT

# Playlist to ZIP

A small local web app that turns a music playlist link into a ZIP of audio files. Paste a link from almost any music site, review the songs it finds on YouTube or SoundCloud, then download everything as MP3 or FLAC in one ZIP.

It runs entirely on your own computer. There are no accounts, API keys, or npm packages to install.

## Features

- Paste a link from Spotify, Deezer, Apple Music, YouTube, SoundCloud, Bandcamp, or Mixcloud, or type songs as `Artist - Title`, one per line.
- Songs from sites that are not themselves a source (Spotify, Deezer, and so on) are searched for on YouTube or SoundCloud. Your choice.
- Review before downloading: see the match for every song, listen to it, switch to another candidate, and tick or untick songs.
- Poor matches are flagged and left unticked so you can check them manually.
- Two modes: Review first (you press Download) or Auto (downloads the best matches straight away).
- MP3 or FLAC output, with title, artist, album, and track number tags.
- Saves the finished playlist as a single ZIP file.
- Songs you already downloaded are skipped when you run the same playlist again.

## Requirements

- Node.js 18 or newer
- yt-dlp
- ffmpeg

Both yt-dlp and ffmpeg must be available on your PATH.

YouTube now requires yt-dlp to use a JavaScript runtime. You do not need to set anything up: the app automatically tells yt-dlp to use Node.js, which you already have. If YouTube searches or downloads stop working, update yt-dlp first (see Troubleshooting).

### Installing the requirements

Windows (PowerShell):

```
winget install OpenJS.NodeJS
winget install yt-dlp
winget install Gyan.FFmpeg
```

macOS (Homebrew):

```
brew install node yt-dlp ffmpeg
```

Linux (Debian or Ubuntu):

```
sudo apt install nodejs ffmpeg
pip install -U "yt-dlp[default]"
```

Open a new terminal afterwards and check that `node --version`, `yt-dlp --version`, and `ffmpeg -version` all work.

## Running it

The easiest way:

- Windows: double-click `start.bat`
- macOS: double-click `start.command` (or run `./start.command`)
- Any system: run `npm start` or `node server.js` in this folder

Your browser opens to http://127.0.0.1:3000 automatically. Keep the terminal window open while you use the app, and close it to stop the app. The first start can take a few seconds while it checks your tools.

Downloaded songs are saved in a `downloads` folder next to `server.js`, in one subfolder per playlist:

```
downloads/
  My Playlist/
    01 - Artist - Title.mp3
    02 - Artist - Title.mp3
```

### Optional settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port the app listens on |
| `DOWNLOAD_DIR` | `./downloads` | Where songs are saved |
| `NO_OPEN` | not set | Set to `1` to stop the browser opening automatically |

Example:

```
PORT=4000 DOWNLOAD_DIR=~/Music/playlists node server.js
```

On Windows PowerShell, set them first with `$env:PORT=4000` and `$env:DOWNLOAD_DIR="C:\Music"`.

## How to use it

1. Paste a playlist link, or type your songs as `Artist - Title` lines.
2. Choose where to search (YouTube or SoundCloud), the format (MP3 or FLAC), and the mode. The app remembers your choices for next time.
3. Press Find songs (or Ctrl+Enter).
4. Rename the playlist if you like. The name is used for the folder and the ZIP file. Then check the matches. Use the dropdown on a song to pick a different candidate, use Listen to hear it, and untick anything you do not want.
5. Press Download selected. When it finishes, the ZIP saves automatically. You can also press the ZIP button at the bottom at any time to zip what has been saved so far.

## Supported sources

| Source | How it is handled |
| --- | --- |
| Spotify playlists, albums, tracks | Song list is read from Spotify's public embed page, then each song is searched on YouTube or SoundCloud |
| Deezer playlists, albums, tracks | Song list is read from Deezer's public API, then searched |
| YouTube, SoundCloud, Bandcamp, Mixcloud | Used directly, since they already point to audio |
| Apple Music and other sites | Best effort, based on the page's embedded song metadata |
| Plain text | Each `Artist - Title` line is searched |

## How matching works

For each song the app searches for the artist and title, then scores the results. A result scores better when its length is close to the original song, when it comes from an auto-generated "Topic" channel, or when the artist name appears in the title or channel. Results that look like live versions, covers, remixes, karaoke, and similar are penalized. Songs whose best result still looks wrong are left unticked so you can decide.

## Notes and limitations

- Spotify support depends on a public page that Spotify can change at any time. If it stops working, paste your songs as text instead. Very large playlists may only return part of the list.
- FLAC files are converted from YouTube or SoundCloud audio. They are lossless copies of a lossy source, so they are larger but do not sound better than the MP3.
- Matching is automatic and not perfect, especially for rare songs. That is why the review step exists.
- Each song is built in a hidden temporary folder and only moved into place when it is complete, so cancelled or failed downloads never leave broken files in your ZIP.
- A ZIP is limited to about 4 GB, and a single run handles up to 1000 songs.
- The server only listens on your own machine (127.0.0.1) and rejects requests from other websites.

## Troubleshooting

- A banner says yt-dlp or ffmpeg is missing: install it, make sure it is on your PATH, and restart `node server.js`.
- Searches or downloads suddenly fail for every song: update yt-dlp with `yt-dlp -U` (or `pip install -U "yt-dlp[default]"`), since sites change often.
- Songs are found but YouTube downloads fail or only some formats work: make sure yt-dlp is up to date and that `node --version` works in the same terminal.
- Port already in use: start with a different port, for example `PORT=4000 node server.js`.
- A song fails to download: it may be region locked, age restricted, or removed. Pick another candidate from the dropdown and try again.

## Project structure

```
server.js       Local backend: reads links, searches, downloads, builds the ZIP
index.html      The web interface
start.bat       Windows launcher
start.command   macOS and Linux launcher
package.json    Lets you run the app with npm start
README.md       This file
```

Suggested `.gitignore`:

```
downloads/
node_modules/
```

## Legal

This tool is meant for music you have the right to download, such as your own uploads, public-domain or Creative Commons music, or content where the site's terms allow it. You are responsible for following copyright law and the terms of service of every site you use. The authors do not support piracy.

