# Third-party notices

Live Union's original source code is GPL-3.0-only, copyright 2026 fishpot9.
Third-party software is not relicensed by that notice.

## Distributed runtime

Windows distributions use Electron 45.2.3. Preserve the runtime's original
`LICENSE` (Electron MIT) and complete `LICENSES.chromium.html` without replacing
them with the Live Union license. The latter includes notices for Chromium,
Node.js, FFmpeg and other bundled components under their respective licenses.
The Live Union GPL is supplied separately as `LICENSE-Live-Union.txt` outside
the application archive and `LICENSE` inside `resources/app.asar`.

- Electron source and build instructions: https://github.com/electron/electron/tree/v45.2.3
- Electron license: https://github.com/electron/electron/blob/v45.2.3/LICENSE

The upstream versioned source tree and its dependency specifications identify
the runtime's component sources. The bundled runtime notice files remain the
authoritative component-specific notices for that binary.

## Build dependencies

Direct build dependencies are pinned in `package-lock.json`:

| Component | Version | Package license |
| --- | --- | --- |
| Electron | 45.2.3 | MIT |
| @electron/packager | 20.3.0 | BSD-2-Clause |
| esbuild | 0.28.2 | MIT |
| TypeScript | 7.0.2 | Apache-2.0 |

Transitive build dependencies retain their own licenses. This table is not a
replacement for those license texts. Build dependencies and `node_modules` are
not copied wholesale into the application archive.

## External services and assets

Huya, Douyu and Bilibili websites and their content are loaded from the services
at runtime. They are not part of the GPL grant over Live Union's original code.
Platform account data and browser profiles are not distributed.

The public source snapshot omits internal design-reference images whose asset
provenance has not been established. No license over those images is granted
by this project.
