#!/usr/bin/env node
'use strict';

// Never give Packager the repository root: it may contain persistent sessions.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const ROOT = path.resolve(__dirname, '../..');
const STAGE = path.join(ROOT, '.local/package-stage');
const candidate = process.argv.includes('--candidate');
const RELEASE = path.join(ROOT, candidate ? '.local/candidate-release' : 'release');
const OUTPUT = path.join(RELEASE, 'Live Union-win32-x64');
const ZIP = path.join(ROOT, '.local/electron-v45.2.3-win32-x64.zip');
const ZIP_SHA256 = '489cd061908e697394b004298bf5ffd345c935d10e8ca197ba819f019ab2dec0';
const INPUTS = [
  'dist/main.cjs', 'dist/preload.cjs',
  'dist/assets/toolbar.html', 'dist/assets/room.html',
  'dist/assets/toolbar.js', 'dist/assets/room.js', 'dist/assets/style.css',
].sort();
const LEGAL_FILES=['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','SOURCE_CODE.md'];
const CONTENTS = ['package.json', ...INPUTS, ...LEGAL_FILES].sort();

async function statOrNull(target) {
  try { return await fs.lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Check every existing path component. Windows junctions are symbolic links too.
async function assertSafePath(target) {
  const absolute = path.resolve(target);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path outside project');
  const parts = relative ? relative.split(path.sep) : [];
  let current = ROOT;
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    const stat = await statOrNull(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path.relative(ROOT, current)}`);
    if (path.resolve(await fs.realpath(current)).toLowerCase() !== current.toLowerCase()) {
      throw new Error(`Refusing redirected path: ${path.relative(ROOT, current)}`);
    }
  }
  return absolute;
}

async function filesUnder(directory, prefix = '') {
  await assertSafePath(directory);
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    await assertSafePath(full);
    if (entry.isDirectory()) files.push(...await filesUnder(full, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Refusing nonregular entry: ${relative}`);
  }
  return files.sort();
}

async function safeRemove(target) {
  const absolute = await assertSafePath(target);
  if (absolute !== STAGE && absolute !== OUTPUT) throw new Error('Cleanup target is not explicitly permitted');
  const stat = await statOrNull(absolute);
  if (!stat) return;
  if (!stat.isDirectory()) throw new Error('Cleanup target is not a directory');
  await filesUnder(absolute); // Reject nested links before any recursive deletion.
  await fs.rm(absolute, { recursive: true, force: false });
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function sameFiles(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} whitelist mismatch. Expected ${expected.join(', ')}; found ${actual.join(', ')}`);
  }
}

async function check() {
  await assertSafePath(path.join(ROOT, 'package.json'));
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    throw new Error('Root package.json must contain a valid version');
  }
  if (pkg.devDependencies?.electron !== '45.2.3' || pkg.devDependencies?.['@electron/packager'] !== '20.3.0') {
    throw new Error('Expected locked Electron 45.2.3 and Packager 20.3.0');
  }
  if(pkg.license!=='GPL-3.0-only')throw new Error('Expected project GPL-3.0-only license metadata');
  const missing = [];
  const inputs = [];
  for (const relative of INPUTS) {
    const file = await assertSafePath(path.join(ROOT, relative));
    const stat = await statOrNull(file);
    if (!stat) { missing.push(relative); continue; }
    if (!stat.isFile() || !stat.size) throw new Error(`Build input is not a nonempty regular file: ${relative}`);
    inputs.push({ path: relative, bytes: stat.size, sha256: await sha256(file) });
  }
  if (missing.length) throw new Error(`NOT READY: missing build files: ${missing.join(', ')}`);
  sameFiles((await filesUnder(path.join(ROOT, 'dist'))).map(file => `dist/${file}`).sort(), INPUTS, 'Build');
  const legalInputs=[];
  for(const relative of LEGAL_FILES){const file=await assertSafePath(path.join(ROOT,relative)),stat=await statOrNull(file);if(!stat?.isFile()||!stat.size)throw new Error(`Missing project legal/source notice: ${relative}`);legalInputs.push({path:relative,bytes:stat.size,sha256:await sha256(file)});}
  if(!(await fs.readFile(path.join(ROOT,'LICENSE'),'utf8')).includes('Version 3, 29 June 2007'))throw new Error('Project GPL text is unavailable');
  await assertSafePath(ZIP);
  const zipStat = await statOrNull(ZIP);
  if (!zipStat?.isFile()) throw new Error('NOT READY: Electron archive missing; run npm run runtime:prepare');
  if (await sha256(ZIP) !== ZIP_SHA256) throw new Error('Local Electron archive SHA-256 mismatch');
  for (const target of [STAGE, OUTPUT]) {
    await assertSafePath(target);
    if (await statOrNull(target)) await filesUnder(target);
  }
  return { pkg, inputs, legalInputs };
}

async function main() {
  const args = process.argv.slice(2);
  const actions=args.filter(arg=>['--check-only','--package'].includes(arg));
  if (actions.length!==1 || args.some(arg=>!['--check-only','--package','--candidate'].includes(arg)) || new Set(args).size!==args.length) {
    throw new Error('Usage: node scripts/package/index.cjs (--check-only | --package) [--candidate]');
  }
  const { pkg, inputs, legalInputs } = await check();
  console.log(`READY: Live Union ${pkg.version}, win32 x64, ${inputs.length} build files and ${legalInputs.length} project notices; local Electron ZIP verified.`);
  if (actions[0] === '--check-only') {
    console.log(JSON.stringify({ stage: '.local/package-stage', output: path.relative(ROOT,OUTPUT).replaceAll('\\','/'), files: CONTENTS, inputs, legalInputs }, null, 2));
    return;
  }
  if (process.platform !== 'win32') throw new Error('This packaging entry is intended for a Windows host');
  await safeRemove(STAGE);
  await fs.mkdir(STAGE, { recursive: true });
  try {
    for (const input of [...inputs,...legalInputs]) {
      const source = await assertSafePath(path.join(ROOT, input.path));
      const destination = await assertSafePath(path.join(STAGE, input.path));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
      if (await sha256(destination) !== input.sha256) throw new Error(`Build changed during staging: ${input.path}`);
    }
    const minimal = {
      name: 'live-union', productName: 'Live Union', version: pkg.version,
      description: 'Local multi-platform live viewing workspace', main: 'dist/main.cjs', private: true,
      author: pkg.author, license: pkg.license, repository: pkg.repository,
    };
    await fs.writeFile(path.join(STAGE, 'package.json'), `${JSON.stringify(minimal, null, 2)}\n`, { flag: 'wx' });
    sameFiles(await filesUnder(STAGE), CONTENTS, 'Staging');
    const { packager } = await import('@electron/packager');
    await safeRemove(OUTPUT);
    await assertSafePath(RELEASE);
    await fs.mkdir(RELEASE, { recursive: true });
    const outputs = await packager({
      dir: STAGE, out: RELEASE, name: 'Live Union', executableName: 'Live Union',
      platform: 'win32', arch: 'x64', electronVersion: '45.2.3', electronZipDir: path.dirname(ZIP),
      appBundleId: 'local.live-union', appVersion: pkg.version,
      asar: true, prune: false, overwrite: false, derefSymlinks: false,
    });
    if (outputs.length !== 1 || path.resolve(outputs[0]) !== OUTPUT) throw new Error('Unexpected Packager output');
    const asarPath = await assertSafePath(path.join(OUTPUT, 'resources/app.asar'));
    const asar = await import('@electron/asar');
    const packagedFiles = asar.listPackage(asarPath)
      .map(file => file.replace(/^[/\\]+/, '').replaceAll('\\', '/'))
      .filter(file => !asar.statFile(asarPath, path.normalize(file)).files).sort();
    sameFiles(packagedFiles, CONTENTS, 'ASAR');
    for (const input of [...inputs,...legalInputs]) {
      const hash = crypto.createHash('sha256').update(asar.extractFile(asarPath, path.normalize(input.path))).digest('hex');
      if (hash !== input.sha256) throw new Error(`ASAR input hash mismatch: ${input.path}`);
    }
    const runtimeNotices=['LICENSE','LICENSES.chromium.html'];
    const originalNoticeHashes=await Promise.all(runtimeNotices.map(relative=>sha256(path.join(OUTPUT,relative))));
    for(const input of legalInputs){const name=input.path==='LICENSE'?'LICENSE-Live-Union.txt':input.path==='NOTICE'?'NOTICE-Live-Union.txt':input.path;const destination=await assertSafePath(path.join(OUTPUT,name));await fs.copyFile(path.join(ROOT,input.path),destination,require('node:fs').constants.COPYFILE_EXCL);if(await sha256(destination)!==input.sha256)throw new Error('Project notice copy mismatch');}
    for(let index=0;index<runtimeNotices.length;index++)if(await sha256(path.join(OUTPUT,runtimeNotices[index]))!==originalNoticeHashes[index])throw new Error('Upstream runtime notice changed');
    const runtimeFiles = await filesUnder(OUTPUT);
    if (!runtimeFiles.includes('Live Union.exe')) throw new Error('Packaged executable missing');
    const artifacts = [];
    for (const relative of runtimeFiles) {
      const full = path.join(OUTPUT, relative);
      artifacts.push({ path: `Live Union-win32-x64/${relative}`, bytes: (await fs.stat(full)).size, sha256: await sha256(full) });
    }
    const manifest = {
      schemaVersion: 1, app: 'Live Union', appId: 'local.live-union', version: pkg.version,
      platform: 'win32', arch: 'x64', electron: '45.2.3', packager: '20.3.0',
      distribution: 'unsigned runnable folder', createdAt: new Date().toISOString(),
      electronArchiveSha256: ZIP_SHA256, inputs, legalInputs, artifacts,
      verification: { packagedContents: 'passed',projectNotices:'included; upstream runtime notices preserved', startup: 'not run', restart: 'not run', upgrade: 'not run', platforms: 'not assessed by packaging' },
    };
    const manifestPath = await assertSafePath(path.join(RELEASE, 'Live Union-win32-x64.manifest.json'));
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`PACKAGED: ${path.relative(ROOT,OUTPUT)} (${artifacts.length} runtime files). Startup/upgrade not verified.`);
    console.log(`SHA-256 manifest: ${path.relative(ROOT,manifestPath)}`);
  } finally {
    await safeRemove(STAGE);
  }
}

main().catch(error => { console.error(`Packaging failed: ${error.message}`); process.exitCode = 1; });
