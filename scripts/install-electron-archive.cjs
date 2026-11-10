'use strict';
// Fallback for environments where Electron's Node downloader stalls.
// The input must be the unmodified official release, verified against npm's checksum.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { extract } = require('@electron-internal/extract-zip');
(async () => {
  const pkg = path.resolve(__dirname, '../node_modules/electron');
  const name = `electron-v${require(path.join(pkg, 'package.json')).version}-win32-x64.zip`;
  const archive = path.resolve(__dirname, '../.local', name);
  const expected = require(path.join(pkg, 'checksums.json'))[name];
  if (!expected) throw new Error('Missing official checksum');
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) digest.update(chunk);
  const actual = digest.digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch: ${actual}`);
  await extract(archive, { dir: path.join(pkg, 'dist') });
  fs.writeFileSync(path.join(pkg, 'path.txt'), 'electron.exe');
  console.log(`Verified SHA256 and installed ${name}: ${actual}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
