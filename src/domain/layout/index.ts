import type {
  LayoutChrome, LayoutInput, LayoutResult, NormalizedRect, RectDip, RoomGeometry, RoomId,
} from '../../shared/contracts.ts';

// Engineering defaults, not a claim about tested native control readability.
const DEFAULT_CHROME: LayoutChrome = {
  headerDip: 32, footerDip: 0, gapDip: 8, minWidthDip: 320, minHeightDip: 200,
};
const POLICY = {
  videoAspect: 16 / 9,
  minVideoWidth: 128,
  minVideoHeight: 72,
  minChatContentHeight: 240,
  emptySlotPenalty: 0.025,
  constrainedPenalty: 0.12,
  focusPrimaryWeight: 0.2,
  focusSharePenalty: 0.08,
  maxFocusSlotsPerRoom: 2,
  focusShare: 0.64,
  minFocusShare: 0.6,
  maxFocusShare: 0.85,
  primaryAreaRatio: 1.5,
  recoveryHandleWidth: 96,
  recoveryHandleHeight: 32,
  cascadeDip: 32,
};
type Canvas = { width: number; height: number };
type Grid = { rects: RectDip[]; columns: number; rows: number };
type Candidate = { rects: RectDip[]; score: number; chatFits: number; grid?: { columns: number; rows: number } };

function finite(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError('Layout numbers must be finite');
}
function nonnegative(value: number): void {
  finite(value);
  if (value < 0) throw new RangeError('Layout dimensions must be nonnegative');
}
function canvasSize(canvas: Canvas, positive = false): void {
  nonnegative(canvas.width);
  nonnegative(canvas.height);
  if (positive && (!canvas.width || !canvas.height)) throw new RangeError('Normalization requires a positive canvas');
}
function validRect(rect: RectDip): void {
  finite(rect.x); finite(rect.y); finite(rect.width); finite(rect.height);
  if (rect.width <= 0 || rect.height <= 0) throw new RangeError('Free rectangles require positive dimensions');
}
function validZ(z: number): void {
  if (!Number.isSafeInteger(z) || z < 0) throw new RangeError('Layout z must be a nonnegative safe integer');
}
function chromeOptions(input?: Partial<LayoutChrome>): LayoutChrome {
  const chrome = { ...DEFAULT_CHROME, ...input };
  for (const value of Object.values(chrome)) nonnegative(value);
  return chrome;
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
function own<T>(record: Readonly<Record<string, T>> | undefined, id: string): T | undefined {
  return record && Object.hasOwn(record, id) ? record[id] : undefined;
}
function contentRect(outer: RectDip, chrome: LayoutChrome): RectDip {
  const header = Math.min(chrome.headerDip, outer.height);
  const footer = Math.min(chrome.footerDip, outer.height - header);
  return { x: outer.x, y: outer.y + header, width: outer.width, height: Math.max(0, outer.height - header - footer) };
}

// Keep fractional DIP until the native view manager converts shared boundaries.
// Gaps shrink on tiny canvases, so rooms stay present instead of overflowing.
function gridRects(area: RectDip, count: number, columns: number, gapPreference: number): Grid {
  const rows = Math.ceil(count / columns);
  const gap = Math.min(gapPreference, area.width / (2 * columns), area.height / (2 * rows));
  const width = Math.max(0, (area.width - gap * (columns - 1)) / columns);
  const height = Math.max(0, (area.height - gap * (rows - 1)) / rows);
  const rects = Array.from({ length: count }, (_, index) => ({
    x: area.x + (index % columns) * (width + gap),
    y: area.y + Math.floor(index / columns) * (height + gap), width, height,
  }));
  return { rects, columns, rows };
}
function videoSize(rect: RectDip, id: RoomId, input: LayoutInput, chrome: LayoutChrome): Canvas {
  const content = contentRect(rect, chrome);
  const chat = own(input.chat, id);
  const available = Math.max(0, content.width - (chat?.visible ? chat.preferredWidthDip : 0));
  const width = Math.min(available, content.height * POLICY.videoAspect);
  return { width, height: width / POLICY.videoAspect };
}
function chatFits(rect: RectDip, id: RoomId, input: LayoutInput, chrome: LayoutChrome): boolean {
  const chat = own(input.chat, id);
  if (!chat?.visible) return true;
  const content = contentRect(rect, chrome);
  return content.width >= chat.preferredWidthDip + POLICY.minVideoWidth
    && content.height >= POLICY.minChatContentHeight;
}
function chatCapacity(rects: RectDip[], input: LayoutInput, chrome: LayoutChrome): number {
  return input.roomIds.reduce((count, id, index) => count
    + Number(!!own(input.chat, id)?.visible && chatFits(rects[index], id, input, chrome)), 0);
}
function better(candidate: Candidate, best: Candidate | undefined): boolean {
  return !best || candidate.chatFits > best.chatFits
    || (candidate.chatFits === best.chatFits && candidate.score > best.score);
}
function constrained(rect: RectDip, id: RoomId, input: LayoutInput, chrome: LayoutChrome): boolean {
  const video = videoSize(rect, id, input, chrome);
  return rect.width < chrome.minWidthDip || rect.height < chrome.minHeightDip
    || video.width < POLICY.minVideoWidth || video.height < POLICY.minVideoHeight || !chatFits(rect, id, input, chrome);
}
function scoreRects(rects: RectDip[], ids: readonly RoomId[], input: LayoutInput, chrome: LayoutChrome): number {
  if (!input.canvas.width || !input.canvas.height) return -1;
  let score = 0;
  for (let index = 0; index < rects.length; index++) {
    const video = videoSize(rects[index], ids[index], input, chrome);
    // Divide before multiplying: scoring cannot overflow on a large finite canvas.
    score += (video.width / input.canvas.width) * (video.height / input.canvas.height);
    if (constrained(rects[index], ids[index], input, chrome)) score -= POLICY.constrainedPenalty / ids.length;
  }
  return score;
}
function equalCandidate(input: LayoutInput, chrome: LayoutChrome): Candidate {
  const area = { x: 0, y: 0, ...input.canvas };
  let best: Candidate | undefined;
  for (let columns = 1; columns <= input.roomIds.length; columns++) {
    const grid = gridRects(area, input.roomIds.length, columns, chrome.gapDip);
    const emptyFraction = (columns * grid.rows - input.roomIds.length) / (columns * grid.rows);
    const candidate = {
      rects: grid.rects,
      score: scoreRects(grid.rects, input.roomIds, input, chrome) - POLICY.emptySlotPenalty * emptyFraction,
      chatFits: chatCapacity(grid.rects, input, chrome),
      grid: { columns, rows: grid.rows },
    };
    if (better(candidate, best)) best = candidate;
  }
  return best!;
}
function focusCandidate(input: LayoutInput, chrome: LayoutChrome): Candidate {
  const ids = input.roomIds;
  const primary = ids.includes(input.primaryRoomId ?? '') ? input.primaryRoomId! : ids[0];
  const primaryIndex = ids.indexOf(primary);
  const share = clamp(input.primaryShare ?? POLICY.focusShare, POLICY.minFocusShare, POLICY.maxFocusShare);
  let best: Candidate | undefined;
  const areaFraction = (rect: RectDip): number => (rect.width / (input.canvas.width || 1)) * (rect.height / (input.canvas.height || 1));
  const consider = (main: RectDip, secondary: RectDip[], emptyFraction: number): void => {
    // Compare fractions instead of raw areas to keep finite arithmetic.
    const mainArea = areaFraction(main), subArea = areaFraction(secondary[0]);
    if (mainArea > 0 && mainArea + Number.EPSILON < subArea * POLICY.primaryAreaRatio) return;
    const rects = secondary.slice();
    rects.splice(primaryIndex, 0, main);
    const video = videoSize(main, primary, input, chrome);
    const primaryScore = (video.width / (input.canvas.width || 1)) * (video.height / (input.canvas.height || 1));
    const preference = input.primaryShare === undefined ? 0
      : POLICY.focusSharePenalty * Math.abs(mainArea - clamp(input.primaryShare, 0, 1));
    const candidate = { rects, chatFits: chatCapacity(rects, input, chrome),
      score: scoreRects(rects, ids, input, chrome) + POLICY.focusPrimaryWeight * primaryScore
        - POLICY.emptySlotPenalty * emptyFraction - preference };
    if (better(candidate, best)) best = candidate;
  };
  for (const horizontal of [true, false]) {
    const axis = horizontal ? input.canvas.width : input.canvas.height;
    const gap = Math.min(chrome.gapDip, axis / 4);
    const primaryLength = (axis - gap) * share;
    const secondaryLength = Math.max(0, axis - gap - primaryLength);
    const main: RectDip = horizontal
      ? { x: 0, y: 0, width: primaryLength, height: input.canvas.height }
      : { x: 0, y: 0, width: input.canvas.width, height: primaryLength };
    const side: RectDip = horizontal
      ? { x: primaryLength + gap, y: 0, width: secondaryLength, height: input.canvas.height }
      : { x: 0, y: primaryLength + gap, width: input.canvas.width, height: secondaryLength };
    for (let columns = 1; columns < ids.length; columns++) {
      const grid = gridRects(side, ids.length - 1, columns, chrome.gapDip);
      const emptyFraction = (columns * grid.rows - (ids.length - 1)) / (columns * grid.rows);
      consider(main, grid.rects, emptyFraction);
    }
  }
  // Preserve the established strip family when no native chat is requested.
  if (ids.some(id => own(input.chat, id)?.visible)) {
    const secondaryCount = ids.length - 1;
    const maxSlots = POLICY.maxFocusSlotsPerRoom * ids.length;
    for (let columns = 1; columns <= maxSlots; columns++) {
      for (let rows = 1; rows <= Math.floor(maxSlots / columns); rows++) {
        const slots = columns * rows;
        if (slots < secondaryCount + 2) continue;
        const gap = Math.min(chrome.gapDip, input.canvas.width / (2 * columns), input.canvas.height / (2 * rows));
        const width = Math.max(0, (input.canvas.width - gap * (columns - 1)) / columns);
        const height = Math.max(0, (input.canvas.height - gap * (rows - 1)) / rows);
        for (let spanColumns = 1; spanColumns <= columns; spanColumns++) {
          for (let spanRows = 1; spanRows <= rows; spanRows++) {
            const mainSlots = spanColumns * spanRows;
            const secondarySlots = slots - mainSlots;
            if (mainSlots < 2 || secondarySlots < secondaryCount) continue;
            const main = { x: 0, y: 0, width: spanColumns * width + (spanColumns - 1) * gap,
              height: spanRows * height + (spanRows - 1) * gap };
            const secondary: RectDip[] = [];
            for (let row = 0; row < rows && secondary.length < secondaryCount; row++) {
              for (let column = 0; column < columns && secondary.length < secondaryCount; column++) {
                if (row < spanRows && column < spanColumns) continue;
                secondary.push({ x: column * (width + gap), y: row * (height + gap), width, height });
              }
            }
            consider(main, secondary, (secondarySlots - secondaryCount) / secondarySlots);
          }
        }
      }
    }
  }
  // The strip family always has a valid candidate for a nonempty secondary set.
  // Keep a total fallback for degenerate/underflowed canvases as well.
  if (best) return best;
  const gap = Math.min(chrome.gapDip, input.canvas.width / 4);
  const width = (input.canvas.width - gap) * POLICY.focusShare;
  const secondary = gridRects({ x: width + gap, y: 0, width: Math.max(0, input.canvas.width - gap - width), height: input.canvas.height }, ids.length - 1, 1, chrome.gapDip).rects;
  const rects = secondary.slice(); rects.splice(primaryIndex, 0, { x: 0, y: 0, width, height: input.canvas.height });
  return { rects, score: scoreRects(rects, ids, input, chrome), chatFits: chatCapacity(rects, input, chrome) };
}

/** Persist only bounded normalized geometry. Off-canvas movement is recovered on load. */
export function toNormalized(rect: RectDip, canvas: Canvas, z: number): NormalizedRect {
  canvasSize(canvas, true); validRect(rect); validZ(z);
  // Compare first to avoid overflow from e.g. MAX_VALUE / MIN_VALUE.
  const ratio = (value: number, dimension: number): number => value <= 0 ? 0 : value >= dimension ? 1 : value / dimension;
  const result = { x: ratio(rect.x, canvas.width), y: ratio(rect.y, canvas.height),
    width: ratio(rect.width, canvas.width), height: ratio(rect.height, canvas.height), z };
  if (!result.width || !result.height) throw new RangeError('Normalized dimensions are too small');
  return result;
}

/** Restore size in current DIP and keep a usable part of the title/drag handle visible. */
export function recoverFreeRect(rect: NormalizedRect, canvas: Canvas, chromeInput?: Partial<LayoutChrome>): RectDip {
  canvasSize(canvas); validRect(rect); validZ(rect.z);
  const chrome = chromeOptions(chromeInput);
  const scaled = (value: number, dimension: number): number => value >= 1 ? dimension : value * dimension;
  const width = Math.min(canvas.width, Math.max(chrome.minWidthDip, scaled(rect.width, canvas.width)));
  const height = Math.min(canvas.height, Math.max(chrome.minHeightDip, scaled(rect.height, canvas.height)));
  const handleWidth = Math.min(POLICY.recoveryHandleWidth, width, canvas.width);
  const handleHeight = Math.min(chrome.headerDip || POLICY.recoveryHandleHeight, height, canvas.height);
  // Clamp the ratio before multiplying; even finite but extreme input stays finite.
  const x = clamp(clamp(rect.x, -1, 1) * canvas.width, handleWidth - width, canvas.width - handleWidth);
  const y = clamp(clamp(rect.y, 0, 1) * canvas.height, 0, canvas.height - handleHeight);
  return { x, y, width, height };
}
function overlaps(a: RectDip, b: RectDip, gap: number): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
    && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}
function freeLayout(input: LayoutInput, chrome: LayoutChrome): { rects: RectDip[]; zs: number[] } {
  const rects: RectDip[] = [];
  const zs: number[] = [];
  const occupied: RectDip[] = [];
  for (const id of input.roomIds) {
    const saved = own(input.freeRects, id);
    if (saved) occupied.push(recoverFreeRect(saved, input.canvas, chrome));
  }
  const existing = input.roomIds.filter(id => own(input.freeRects, id));
  const top = existing.reduce((value, id) => Math.max(value, own(input.freeRects, id)!.z), -1);
  const missingCount = input.roomIds.length - existing.length;
  // Usually preserve saved z exactly. At integer exhaustion, compact the same
  // stable stack order so newly added overlapping rooms can still appear on top.
  const compactZ = top > Number.MAX_SAFE_INTEGER - missingCount;
  const ranked = [...existing].sort((a, b) => own(input.freeRects, a)!.z - own(input.freeRects, b)!.z);
  const ranks = new Map(ranked.map((id, index) => [id, index]));
  let nextZ = compactZ ? existing.length : top + 1;
  const fallback = equalCandidate(input, chrome).rects[0];
  for (let index = 0; index < input.roomIds.length; index++) {
    const saved = own(input.freeRects, input.roomIds[index]);
    if (saved) {
      rects.push(recoverFreeRect(saved, input.canvas, chrome));
      zs.push(compactZ ? ranks.get(input.roomIds[index])! : saved.z); continue;
    }
    const width = Math.min(input.canvas.width, Math.max(chrome.minWidthDip, fallback.width));
    const height = Math.min(input.canvas.height, Math.max(chrome.minHeightDip, fallback.height));
    const xs = [0, ...occupied.map(rect => rect.x + rect.width + chrome.gapDip)].sort((a, b) => a - b);
    const ys = [0, ...occupied.map(rect => rect.y + rect.height + chrome.gapDip)].sort((a, b) => a - b);
    let placed: RectDip | undefined;
    for (const y of ys) {
      for (const x of xs) {
        const candidate = { x, y, width, height };
        if (x >= 0 && y >= 0 && x <= input.canvas.width - width && y <= input.canvas.height - height
          && !occupied.some(rect => overlaps(candidate, rect, chrome.gapDip))) { placed = candidate; break; }
      }
      if (placed) break;
    }
    if (!placed) {
      const offset = index * POLICY.cascadeDip;
      placed = { x: Math.min(offset, input.canvas.width - width), y: Math.min(offset, input.canvas.height - height), width, height };
    }
    occupied.push(placed); rects.push(placed); zs.push(nextZ++);
  }
  return { rects, zs };
}

/** Pure DIP geometry only: never creates/navigates a room or changes audio/chat state. */
export function computeLayout(input: LayoutInput): LayoutResult {
  canvasSize(input.canvas);
  const chrome = chromeOptions(input.chrome);
  if (!['equal', 'focus', 'free'].includes(input.template)) throw new RangeError('Unknown layout template');
  if (new Set(input.roomIds).size !== input.roomIds.length
    || input.roomIds.some(id => typeof id !== 'string' || !id.length)) throw new RangeError('Room IDs must be unique nonempty strings');
  if (input.primaryShare !== undefined) finite(input.primaryShare);
  for (const id of input.roomIds) {
    const chat = own(input.chat, id);
    if (chat) {
      if (typeof chat.visible !== 'boolean') throw new TypeError('Chat visibility must be boolean');
      nonnegative(chat.preferredWidthDip);
    }
  }
  const rooms: Record<RoomId, RoomGeometry> = Object.create(null);
  const order = [...input.roomIds];
  if (!order.length) return { rooms, order, spaceConstrained: false };
  let rects: RectDip[];
  let zs = order.map((_, index) => index);
  let grid: LayoutResult['grid'];
  if (input.template === 'free') ({ rects, zs } = freeLayout(input, chrome));
  else if (order.length === 1) {
    rects = [{ x: 0, y: 0, ...input.canvas }];
    if (input.template === 'equal') grid = { columns: 1, rows: 1 };
  } else {
    const candidate = input.template === 'equal' ? equalCandidate(input, chrome) : focusCandidate(input, chrome);
    rects = candidate.rects; grid = candidate.grid;
  }
  let spaceConstrained = false;
  order.forEach((id, index) => {
    const outer = rects[index];
    rooms[id] = { outer, content: contentRect(outer, chrome), z: zs[index] };
    spaceConstrained ||= constrained(outer, id, input, chrome);
  });
  return grid ? { rooms, order, spaceConstrained, grid } : { rooms, order, spaceConstrained };
}
