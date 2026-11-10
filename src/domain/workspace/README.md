# WorkspaceModel integration notes

`WorkspaceModel` implements the frozen `WorkspaceModelApi` using plain data and the
existing layout functions. The constructor and `setCanvas` take the content canvas
after the root has deducted `UI_METRICS.toolbarDip`. Geometry starts at (0,0); the
runtime adds its toolbar offset. Layout chrome uses the shared 36/8/8 DIP header,
footer and gap, plus 220×120 DIP frame minimums.

The root owns URL normalization, workspace schema validation, persistence, runtime
lifecycle, presentation adapters and the unique audio policy. Pass already-normalized
`RoomConfig` objects to `addRoom`; duplicate current IDs and canonical URL strings
throw without changes. Audio in new room configuration is kept as supplied. The root
creates new instances muted and mirrors the runtime policy's resulting map through
`setAudioAllowed`. `apply` returns false for runtime, audio, network, menu, fullscreen
and catalog commands; it performs no side effects for those commands.

Snapshot and geometry getters return defensive copies. Undo stores up to 30 layout
checkpoints, never room/chat/audio copies. Adding/removing rooms clears undo and active
gestures, so undo cannot reopen a closed room. A deleted main room selects its next
neighbor using the old stable order, wrapping at the end. Each auto template retains
its own order; switching to auto does not erase saved free rectangles. `setFree`
restores those rectangles by default; `fromCurrent` replaces them with the current
underlying geometry. `arrange` uses the current base template and is undoable.

Free move/resize gestures use absolute deltas from the begin rectangle. Preview is
transient; only matching end writes normalized geometry and one undo checkpoint.
Positions stay nonnegative and retain a visible title handle; dimensions respect
220×120 DIP where the canvas permits and never exceed the canvas. Auto movement
previews no arbitrary frame displacement; its end swaps the template order when the
translated source center hits another room. A main/secondary swap also updates the
main ID. Auto resize is ignored. Layout/presentation changes and canvas resizing
cancel active gestures; stale gesture messages are ignored. Free move/resize snaps
to canvas or nearby room edges within 8 DIP, with no movement on an untouched axis.
Rooms can still overlap. Resize snaps the right and bottom edges; nearby rooms must
overlap on the perpendicular axis or be within 8 DIP of it.

Zoom and native mode are independent transient overlays. Both retain all underlying
room geometry; native is above zoom when both exist. Removing the overlays restores
the current underlying layout. Neither overlay enters persistent snapshots or undo.
Gestures are ignored while an overlay is active. z values compact safely at integer
exhaustion without changing stacking order or audio.

`replaceSnapshot` clears selection, overlays, gestures and undo by default.
`preserveTransient=true` requires the same room-ID set and is intended for root-managed
save-as; it preserves current transients and history. The root must separately undo
native-page adaptation when leaving native mode, and avoid runtime recreation for
save-as and all geometry operations.

The local tests prove data/geometry transitions only. Native hit testing, actual view
stacking, page adaptation/restore, runtime identity/navigation, audio timing, true DPI
transitions, real platforms and nine-stream performance remain integration work.
