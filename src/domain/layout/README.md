# T04 offline layout contract notes

This module implements data/layout v1.0 only. All positions and dimensions are
logical DIP; no device scale factor, CSS pixel conversion, native bounds rounding,
page manipulation, room runtime, audio policy, network, or persistence is involved.

`computeLayout` preserves input room order and returns every room. Equal candidates
enumerate column counts from 1 through the actual room count. Focus candidates
enumerate horizontal/vertical main strips and, when chat is requested, integer-cell
main blocks in grids with at most twice as many slots as current rooms. The main
block starts at the top left; equal secondary cells fill remaining positions in
row-major room order. No room count has a dedicated template or mode.

Candidates first maximize the number of explicitly opened chats with at least the
requested chat width plus a 128 DIP video preview and 240 DIP content height. They
then compare fitted 16:9 video area, primary-room weight and empty-slot/readability
penalties. Chat preferences only influence geometry scoring; `content` remains one
whole native-page rectangle. Rendering/adapter code
must still preserve the video's actual aspect ratio and original native chat.

The engineering defaults are a 32 DIP header, no footer, 8 DIP gaps, and 320×200
DIP minimum room frame. Scoring also treats video estimates below 128×72 and opened
chat that misses its width/height budget as constrained. These are geometry budgets,
not a claim that platform controls or actual chat have passed compatibility tests.
The frame defaults are unverified usability thresholds, not supported minimum-window
claims. Small canvases shrink gaps and keep all rooms, setting `spaceConstrained`;
zero-sized canvases return zero-sized available geometry without hiding room IDs.
Fractional DIP are retained so native integration can round shared boundaries once.

The existing focus strip family uses a 0.64 default main-axis share, clamping its
strip split to 0.60–0.85. A supplied `primaryShare` also acts as a soft area preference
across all focus candidates; it cannot override feasible chat or the hard minimum
main/secondary frame-area ratio of 1.5. Spanning main blocks can use less than 60%
of the canvas to retain usable secondary chats. With all chats closed, focus keeps
the existing strip family. Invalid/missing primary IDs fall back to the first current
room. The caller must select the successor from the old order when deleting a main
room: the frozen input does not include the deleted room's previous index.

`toNormalized` requires finite coordinates, positive sizes/canvas, and a nonnegative
safe-integer z. It clamps x/y individually to [0,1] and width/height to (0,1], without
requiring x+width or y+height to be at most 1. Negative positions become 0; frames
larger than the canvas become normalized size 1. Zero/underflowed sizes throw.

`recoverFreeRect` accepts finite off-canvas ratios, caps restored size to the current
canvas, and enforces the minimum frame size where space permits. It keeps up to
96 DIP of title width and the configured header height (32 DIP if no header) visible.
Overlapping saved rooms retain their z. New rooms first search vacant edge positions,
then cascade in a visible position above existing rooms; exhausted safe-integer z
values are compacted in the same stable layer order before adding new rooms.

Geometry has no undo/history, snapping command, temporary-zoom state, or template
state store. Those belong to the controller/editor. Unit tests cover geometry and
normalization only; native stacking, hit testing, live video fit, real DPI changes,
platform compatibility, runtime reuse, audio independence, and nine-stream performance
remain integration/real-platform acceptance work.
