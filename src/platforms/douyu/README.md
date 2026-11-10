# Douyu presentation adapter

Version: `2026.11.07.3`. Contract: ADR002 / `PlatformPresentation` in `src/shared/app-contracts.ts`.

`index.ts` exports `adapter`; its CJS implementation and exact `.d.cts` declaration are colocated so TypeScript and esbuild can statically import the fixed packaged builder. There are no runtime imports from G0 probes, no dependencies to install, and no public contract changes.

The adapter only constructs fixed page scripts from three validated presentation preferences. It never receives arbitrary page/user code. The application must associate each execution with the correct room and runtime generation and validate all returned page data; the page diagnostic symbol is untrusted observation, not authority or proof of platform compatibility.

## Retained native structure

- Video root: `#js-player-video`, with one geometrically visible native video and a bounded ancestor sizing chain.
- Native frame: the video's immediate parent must contain the video root and a unique SDK sibling; extra branches must remain inert (zero area, no video/editable/danmu/aside) and may naturally be removed. The SDK branch must have local `danmu` / `Danmu` semantic DIV roots, matching native video-root geometry, no independent video and no aside. Its own native editors/settings remain attached and unread. A global class match never makes a branch retained.
- The complete native frame is retained. Version `.2` incorrectly hid the SDK sibling that owns native controls and DOM danmu renderers; the anonymous real-page diagnosis is recorded in `docs/evidence/integration/2026-11-07-douyu-diagnosis.md`.
- Chat common root: `#js-player-asideMain`, containing both `.Barrage` / `#js-barrage-list` history and `.layout-Player-chat` with one native editable element.
- The history UL remains unchanged; four observed wrapper levels preserve native scrollbar dimension differences. Message text and input values are never inspected.
- The native frame, aside and their descendants stay attached. Only ordinary sibling branches outside their ancestor paths are hidden; script/style/link/meta/template/noscript nodes are preserved. Up to 512 sibling elements are examined per application.
- Page-root scrollbars are released before measuring the viewport. Frame/aside ancestor stacking contexts are raised; the video is not raised above the SDK. All changed inline properties are recorded independently for rollback.

## Geometry, lifecycle and diagnostics

The frame occupies the available video area. Native video intrinsic dimensions determine one complete contain rectangle shared by the video root and SDK sibling. Only the bounded SDK ancestor paths leading to identified full-size outer danmu roots are sized; controls, message descendants, animation transforms, font, opacity and native display/visibility settings are unchanged. Actual video/SDK/visible outer-root boxes must match the expected rectangle within 2 CSS pixels or the adapter rolls back with `native-geometry`.

Native hidden roots remain hidden, independently of the application's chat sidebar. Initially hidden roots without a provable layout box are retained without sizing their paths. If native settings reopen such a root, its actual geometry must pass the same postcheck; stale geometry restores the original page instead of claiming success. Intrinsic media geometry not yet available also restores the original page. No playback, refresh or automatic enable workaround is attempted.

With `chatVisible=false`, every positive viewport remains eligible for compact contain presentation when native structure and media geometry are valid. Pure mock tests cover 220×140, 220×180, 220×120 and 160×90, plus 4:3 and portrait sources; these are arithmetic/control-flow checks, not real browser pixel or usability verification. Native controls are retained; a small viewport may require the application to enlarge the room for menus and full interaction.

With `chatVisible=true`, the requested chat width must be at least 380px, the contained game preview at least 128px wide and viewport height at least 240px. This supports the general spanning focus layout without reducing native history or sender budgets. Preview widths below 320px report `controls-need-zoom`. Requests that cannot preserve the native history and send area return `unsupported` and restore the full page. The adapter never silently hides chat, changes its requested width, changes quality, or pauses playback to fit a layout. The application must present an honest fallback and enlargement option when full-page mode is unsuitable for a small room.

Same-version application reuses one observer and listener set. A changed production adapter version disposes the old closure before installing the new version. `compact=false` restores owned styles and cancels observers, throttle timers, animation frames and listeners. Newer distinct inline values written by the platform are retained. Styles set later by the platform to an identical value cannot be distinguished from the adapter's own value.

`globalThis[Symbol.for('live-union.presentation.result')]` is updated by explicit commands and asynchronous resize/structure/fullscreen outcomes. `applied/candidate-layout` only means the presentation operation completed; it never means live playback, messages were painted, no occlusion, successful login or passed acceptance. Output includes fixed status/reason strings, contain geometry, a checked SDK alignment boolean and an identified-root count. The symbol contains no account, chat, native class strings or media-source values. Like all page results it remains untrusted and must be validated by the host.

`Symbol.for('live-union.douyu.presentation.geometry')` preserves the last failing intrinsic/frame/player/SDK/video/danmu geometry before rollback. It contains only a fixed part enum, numeric index and x/y/width/height boxes; nonfinite or absolute values above 10,000,000 become null. Successful postchecks reset it to `aligned`. Hosts must whitelist these page-provided fields before logging; it is not an IPC capability or a substitute for platform verification.

Direct ancestor child-list changes and fixed SDK path/root `style`/`class`/`hidden` attributes are throttled 120ms and then aligned to an animation frame. Root attributes are observed without their child lists; message descendants are not observed. Native video metadata/aspect-resize events use the same bounded schedule and are removed on disposal. Unknown structure, excessive sibling count, incompatible containing blocks, lost/reparented nodes or postcheck mismatches trigger rollback. Visible semantic dialogs trigger `unsupported/native-overlay`; native fullscreen also rolls back without exiting fullscreen.

Custom nonsemantic login/global portals outside the retained paths can be hidden in compact mode. Those flows require explicit full-page restoration/enlargement by the application. Semantic dialog detection is not a complete compatibility claim for all platform overlays. The adapter never navigates, refreshes, sends input, calls media playback APIs, reads media addresses, changes mute/volume/quality/danmaku, or reads credentials/session/chat values.

## Checks actually executed

```powershell
node --check src/platforms/douyu/presentation.cjs
node --test tests/unit/douyu/presentation.test.cjs tests/unit/douyu/adapter.test.ts
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

All pass; 25 unit tests cover validated source generation, exports, idempotence, identity/parent retention, independent chat, native hidden roots, explicit contain geometry for 16:9/4:3/portrait sources, small layouts, structure ambiguity, real-box postcheck failure, metadata changes, root/class/path loss, inert frame siblings, native SDK editors, cleanup and normalized CSSOM rollback. Mock playback/audio/source/current-time accessors and input-value accessors throw; only intrinsic media dimensions are read. The fixture models basic box arithmetic and the observed video/SDK sibling relationship. It cannot prove Chromium layout, painting, event hit testing or real-platform compatibility. Main-agent hidden Chromium, anonymous real-page and dev.5 desktop results are recorded in `docs/evidence/integration/2026-11-07-douyu-dev5-fix.md`.

## Requirements and remaining verification

Implementation targets FR05, FR13, FR15, FR20–22, FR28, NFR03, NFR06 and NFR08; tests prepare AT08–13, AT17, AT24–25 and AT28. They do not establish real-platform acceptance.

Production `.3` real-page root alignment, menu boundaries/hit testing, actual source corners, small-window occlusion, native scroll interaction, IME, approved sending, native overlay/login return, DPI, same-platform multiroom preferences and nine-room performance remain unverified by this module author. The main agent owns those serial tests and formal evidence. This task read the specifically authorized numeric anonymous diagnosis; it did not run Electron, use the desktop/network, open a live app/session or touch the current release. The separately reported login/reload issue is not explained or repaired by this presentation change.
