# Playlist to ZIP

A free, local-only web app for turning a playlist or a list of songs into one ZIP of MP3 or FLAC files. It has no accounts, ads, analytics, telemetry, API keys, or cloud service. The server binds only to `127.0.0.1`.

Use it only for music you have the right to download and in accordance with each site's terms.

## Requirements and first-time setup

- Node.js 18 or newer
- `yt-dlp`
- `ffmpeg`

The app uses only Node.js built-ins; there are no npm packages to install. `npm install` is not needed.

### Windows

1. Install Node.js if needed: `winget install --id OpenJS.NodeJS.LTS -e`
2. Double-click `start.bat`.
3. On the first run, the setup check identifies missing tools, prints exact commands, and offers to install `yt-dlp` and FFmpeg with `winget`. Approve the prompt to continue.
4. If an installation changed PATH, close the setup window and double-click `start.bat` again.

Manual install commands:

```powershell
winget install --id yt-dlp.yt-dlp -e
winget install --id Gyan.FFmpeg.Shared -e
```

In Windows PowerShell, use `npm.cmd start`, `npm.cmd run doctor`, or `npm.cmd test` if your execution policy blocks the `npm.ps1` shim.

### macOS

Install Homebrew if it is not already installed, then run:

```sh
brew install node yt-dlp ffmpeg
```

Start the app with `npm start`. The doctor is also available with `npm run doctor`. To use the included launcher, run `chmod +x start.command` once, then double-click it or run `./start.command`.

### Linux (Debian or Ubuntu)

```sh
sudo apt-get update
sudo apt-get install -y nodejs yt-dlp ffmpeg
```

Start with `npm start`. The setup doctor can offer to install `yt-dlp` and FFmpeg through `apt-get` after confirmation. On other Linux distributions, install the same tools through the distribution's package manager.

### Setup check

Run `npm run doctor` to see which requirements are available. The check does not install anything without asking. The Windows launcher checks for Node.js before it invokes the doctor.

YouTube may require a current yt-dlp version and Node.js as its JavaScript runtime. This app asks yt-dlp to use the installed Node.js runtime when the installed yt-dlp version supports that option.

## Starting and using the app

- Windows: double-click `start.bat`.
- macOS or Linux: `npm start` (or the included `start.command` launcher).

The server opens `http://127.0.0.1:3000` in your browser. Leave the console window open while using the app; closing it stops the local server. If the browser does not open automatically, visit that address yourself.

1. Paste a supported playlist link or enter `Artist - Title` on each line.
2. Pick YouTube or SoundCloud, MP3 or FLAC, and Review first or Auto.
3. Choose **Find songs**. In Review mode, listen to a candidate, switch matches, and select the songs you want. Poor matches are left unselected.
4. Choose **Download selected**. Completed songs are tagged and saved; when the run finishes, the ZIP is downloaded automatically. The ZIP button can also download already completed songs.

The interface adapts to phone-sized screens. Your service, format, and mode preferences are stored in your browser's local storage only.

## Features and limits

- Spotify, Deezer, Apple Music, YouTube, SoundCloud, Bandcamp, and Mixcloud links, plus plain song lists.
- Candidate review, manual candidate switching, selection controls, Auto and Review modes.
- MP3 and FLAC conversion with title, artist, album, and track number metadata.
- Up to 1,000 songs per playlist. Input is bounded; exceptionally large playlists must be split.
- Long and special-character song names are normalized to safe, bounded file names.
- A failed, cancelled, or disconnected download is kept in a hidden temporary directory and cleaned up; only completed files are included in a ZIP. A repeated download skips existing files.
- One download run at a time prevents simultaneous runs from racing over files.
- The built-in ZIP writer supports archives up to 4 GB; larger archives are rejected clearly.
- The download folder is created automatically at `downloads/` in the project. Set `DOWNLOAD_DIR` to choose another local folder.

### Optional settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Local HTTP port (1–65535) |
| `DOWNLOAD_DIR` | `./downloads` | Destination for playlist folders |
| `NO_OPEN` | unset | Set to `1` to skip automatic browser opening |

For example, on PowerShell:

```powershell
$env:PORT=4000
npm start
```

On macOS/Linux:

```sh
PORT=4000 npm start
```

If the port is already occupied, the app reports the conflict. Pick another port with `PORT`.

## Tests

Run the built-in test suite with:

```sh
npm test
```

It covers line parsing and playlist bounds, URL allowlisting, safe file names, match scoring, and ZIP file structure/CRC/UTF-8 names. Tests need no network and no extra packages.

## Project structure

```text
public/             Static browser interface (HTML, CSS, JavaScript)
server/index.js     Local-only HTTP server, source parsing, search, downloads, ZIP writer
scripts/doctor.js   Dependency check and optional package-manager installer
test/core.test.js   Offline automated tests using Node's built-in test runner
downloads/          Created automatically for completed files (ignored by Git)
start.bat           Windows double-click launcher
start.command       macOS/Linux launcher
package.json        Start, doctor, and test commands (no package dependencies)
README.md           Setup and usage documentation
```

## Privacy and safety

The server binds explicitly to `127.0.0.1`, checks the local Host and Origin, exposes only the app's static files, and only accepts supported HTTPS music-source URLs for extraction and downloads. Download names are reduced to safe file-name segments, and ZIP access stays under the configured downloads root and excludes symbolic links. Child processes are started with fixed executable names and argument arrays; user text is never evaluated as a shell command.

## Change log

- Moved the web interface into `public/` and the backend into `server/`.
- Added a first-run doctor, Windows/macOS/Linux install instructions, launchers, npm commands, and offline tests without adding npm dependencies.
- Bounded input, playlist sizes, process output, remote responses, song names, and ZIP sizes; added HTTPS host allowlisting, download validation, path containment, and a single-download lock.
- Improved failure visibility for individual match errors, network checks, cancelled streams, and occupied ports.
- Added compact mobile layout and accessible control labels/keyboard focus.

## Not tested here

- Live Spotify, Deezer, Apple Music, YouTube, SoundCloud, Bandcamp, or Mixcloud extraction/search/download behavior (these services change independently).
- Actual installation through `winget`, Homebrew, or `apt-get`, since it depends on the host OS and package-manager permissions.
- Real MP3/FLAC encoding and embedded tags, which require installed yt-dlp and FFmpeg.

The automated tests validate local parsing/scoring/name/ZIP logic without making network requests or downloading any media.
