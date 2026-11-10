# Corresponding source

Publication target: https://github.com/fishpotdev9/live-union

This repository is the source for Live Union. A binary release must point to
the matching source tag or commit and provide that complete source snapshot
alongside the binary. Do not attach a binary built from uncommitted changes to
a different source release.

The source snapshot includes `src`, `scripts`, `tests`, `package.json`,
`package-lock.json`, `tsconfig.json` and project license/notice files. Generated
`dist`, dependency caches, browser profiles and private diagnostic logs are not
required to build the program and are not distributed as project source.

## Build on Windows x64

Use Node.js 24.12 or a later Node.js 24 version and npm. From a clean checkout:

```powershell
npm ci
npm run runtime:prepare
npm run runtime:install
npm run typecheck
npm run test:unit
npm run build
npm run package:check
npm run package
```

`runtime:prepare` downloads the pinned official Electron Windows x64 ZIP and
verifies its SHA-256 against Electron's packaged checksums and the project's
pin. An already downloaded official archive can be supplied explicitly:

```powershell
npm run runtime:prepare -- C:\Downloads\electron-v45.2.3-win32-x64.zip
npm run runtime:install
```

The archive is cached under the ignored `.local` directory. Do not commit it.
The Electron source and its own build instructions are linked in
`THIRD_PARTY_NOTICES.md`; the unmodified runtime notices accompany binaries.

## Local verification

```powershell
node scripts/test-package.cjs --hidden --quick
```

This runs generated local pages with temporary data. It does not verify real
streaming accounts, platform compatibility or nine-room performance. Public
releases must state those results separately.
