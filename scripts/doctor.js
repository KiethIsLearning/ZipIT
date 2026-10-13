#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');

const checks = [
  { name: 'Node.js', command: 'node', args: ['--version'], minimumMajor: 18 },
  { name: 'yt-dlp', command: 'yt-dlp', args: ['--version'] },
  { name: 'ffmpeg', command: 'ffmpeg', args: ['-version'] }
];

const instructions = {
  win32: {
    'Node.js': 'winget install --id OpenJS.NodeJS.LTS -e',
    'yt-dlp': 'winget install --id yt-dlp.yt-dlp -e',
    ffmpeg: 'winget install --id Gyan.FFmpeg.Shared -e'
  },
  darwin: {
    'Node.js': 'brew install node',
    'yt-dlp': 'brew install yt-dlp',
    ffmpeg: 'brew install ffmpeg'
  },
  linux: {
    'Node.js': 'Use your distribution package manager to install Node.js 18 or newer.',
    'yt-dlp': 'sudo apt-get update && sudo apt-get install -y yt-dlp',
    ffmpeg: 'sudo apt-get install -y ffmpeg'
  }
};

function checkTool(tool) {
  const result = spawnSync(tool.command, tool.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  if (result.error || result.status !== 0) return { ok: false, version: '' };
  const version = (result.stdout || '').trim().split(/\r?\n/, 1)[0];
  if (tool.minimumMajor) {
    const match = version.match(/v?(\d+)\./);
    if (!match || Number(match[1]) < tool.minimumMajor) return { ok: false, version };
  }
  return { ok: true, version };
}

function printReport() {
  const missing = [];
  console.log('Playlist to ZIP setup check');
  for (const tool of checks) {
    const result = checkTool(tool);
    console.log(`${result.ok ? '[OK]' : '[MISSING]'} ${tool.name}${result.version ? ` — ${result.version}` : ''}`);
    if (!result.ok) missing.push(tool);
  }
  return missing;
}

async function installMissing(missing) {
  const platformInstructions = instructions[process.platform];
  if (!platformInstructions) return;

  console.log('\nInstall commands for this system:');
  for (const tool of missing) console.log(`  ${tool.name}: ${platformInstructions[tool.name]}`);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let answer;
  try {
    answer = await rl.question('\nTry installing the missing tools now using your system package manager? [y/N] ');
  } finally {
    rl.close();
  }
  if (!/^y(es)?$/i.test(answer.trim())) return;

  for (const tool of missing) {
    if (tool.name === 'Node.js') continue;
    const platform = process.platform;
    let command;
    let args;
    if (platform === 'win32') {
      command = 'winget';
      args = ['install', '--id', tool.name === 'yt-dlp' ? 'yt-dlp.yt-dlp' : 'Gyan.FFmpeg.Shared', '-e', '--accept-package-agreements', '--accept-source-agreements'];
    } else if (platform === 'darwin') {
      command = 'brew';
      args = ['install', tool.name];
    } else if (platform === 'linux') {
      command = 'sudo';
      args = tool.name === 'yt-dlp'
        ? ['apt-get', 'update']
        : ['apt-get', 'install', '-y', 'ffmpeg'];
    }
    if (!command) continue;

    if (platform === 'linux' && tool.name === 'yt-dlp') {
      const update = spawnSync(command, args, { stdio: 'inherit' });
      if (update.status !== 0) {
        console.error('Package index update failed; yt-dlp was not installed.');
        continue;
      }
      args = ['apt-get', 'install', '-y', 'yt-dlp'];
    }
    console.log(`\nInstalling ${tool.name}...`);
    const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) console.error(`Installation failed for ${tool.name}. Run the command above manually.`);
  }
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 18) {
    console.error('Node.js 18 or newer is required.');
    process.exitCode = 1;
    return;
  }
  let missing = printReport();
  if (!missing.length) {
    console.log('\nAll required tools are ready.');
    return;
  }
  await installMissing(missing);
  missing = printReport();
  if (missing.length) {
    console.error('\nSetup is incomplete. Install the missing tools above, then run this check again.');
    process.exitCode = 1;
  } else {
    console.log('\nAll required tools are ready.');
  }
}

main().catch(error => {
  console.error(`Setup check failed: ${error.message}`);
  process.exitCode = 1;
});
