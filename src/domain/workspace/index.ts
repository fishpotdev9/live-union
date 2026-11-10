import { computeLayout, recoverFreeRect, toNormalized } from '../layout/index.ts';
import { UI_METRICS } from '../../shared/app-contracts.ts';
import type { AppCommand } from '../../shared/app-contracts.ts';
import type { LayoutResult, NormalizedRect, RectDip, RoomConfig, RoomGeometry, RoomId, WorkspaceSnapshot } from '../../shared/contracts.ts';
import type { WorkspaceModelApi } from '../../shared/workspace-model.ts';

type Canvas = { width: number; height: number };
type LayoutState = WorkspaceSnapshot['layout'];
type Gesture = {
  id: string; roomId: RoomId; kind: 'move' | 'resize';
  original: RectDip; preview: RectDip; before: LayoutState;
  automatic: boolean; dx: number; dy: number;
};
const CHROME = {
  headerDip: UI_METRICS.headerDip, footerDip: UI_METRICS.footerDip,
  gapDip: UI_METRICS.gapDip, minWidthDip: UI_METRICS.minWidthDip, minHeightDip: UI_METRICS.minHeightDip,
};
const UNDO_LIMIT = 30;
const SNAP_DIP = 8;
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
function adjacentSpan(start: number, length: number, otherStart: number, otherLength: number): boolean {
  return start <= otherStart + otherLength + SNAP_DIP && otherStart <= start + length + SNAP_DIP;
}
function nearestSnap(value: number, targets: readonly number[], min: number, max: number): number {
  let selected = value;
  let distance = Infinity;
  for (const target of targets) {
    if (!Number.isFinite(target) || target < min || target > max) continue;
    const delta = Math.abs(target - value);
    // First candidate wins ties: canvas edges, then the stable room order.
    if (delta <= SNAP_DIP && delta < distance) { selected = target; distance = delta; }
  }
  return selected;
}
function validateCanvas(canvas: Canvas): Canvas {
  if (![canvas.width, canvas.height].every(value => Number.isFinite(value) && value >= 0)) {
    throw new RangeError('Canvas dimensions must be finite and nonnegative');
  }
  return { width: canvas.width, height: canvas.height };
}
function validateRoom(room: RoomConfig): void {
  if (typeof room.id !== 'string' || !room.id || typeof room.canonicalUrl !== 'string' || !room.canonicalUrl
    || typeof room.chat.visible !== 'boolean' || !Number.isFinite(room.chat.preferredWidthDip)
    || room.chat.preferredWidthDip < 0 || room.chat.preferredWidthDip > 16384
    || typeof room.audio.allowed !== 'boolean') throw new TypeError('Invalid room configuration');
  if (room.audio.preferredVolume !== undefined && (!Number.isFinite(room.audio.preferredVolume)
    || room.audio.preferredVolume < 0 || room.audio.preferredVolume > 1)) throw new TypeError('Invalid room volume preference');
}
function checkedSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const result = clone(snapshot);
  if (result.schemaVersion !== 1 || typeof result.name !== 'string'
    || !['equal', 'focus'].includes(result.layout.base) || !['auto', 'free'].includes(result.layout.editing)
    || !['equal', 'focus'].includes(result.layout.free.from)) throw new TypeError('Invalid workspace state');
  result.rooms.forEach(validateRoom);
  const ids = new Set(result.rooms.map(room => room.id));
  if (ids.size !== result.rooms.length || new Set(result.rooms.map(room => room.canonicalUrl)).size !== ids.size) {
    throw new TypeError('Duplicate workspace room');
  }
  for (const order of [result.stableOrder, result.layout.equal.order, result.layout.focus.order]) {
    if (order.length !== ids.size || new Set(order).size !== ids.size || order.some(id => !ids.has(id))) {
      throw new TypeError('Workspace orders must contain each room exactly once');
    }
  }
  for (const [id, rect] of Object.entries(result.layout.free.rects)) {
    if (!ids.has(id) || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
      || rect.x < 0 || rect.x > 1 || rect.y < 0 || rect.y > 1
      || rect.width <= 0 || rect.width > 1 || rect.height <= 0 || rect.height > 1
      || !Number.isSafeInteger(rect.z) || rect.z < 0) throw new TypeError('Invalid saved free geometry');
  }
  if (result.layout.primaryRoomId !== undefined && !ids.has(result.layout.primaryRoomId)) {
    result.layout.primaryRoomId = result.stableOrder[0];
  }
  result.layout.primaryRoomId ??= result.layout.focus.order[0];
  if (result.layout.focus.primaryShare !== undefined && (!Number.isFinite(result.layout.focus.primaryShare)
    || result.layout.focus.primaryShare < 0.05 || result.layout.focus.primaryShare > 0.95)) throw new TypeError('Invalid main share preference');
  return result;
}
function geometryFor(outer: RectDip, z: number): RoomGeometry {
  const header = Math.min(CHROME.headerDip, outer.height);
  const footer = Math.min(CHROME.footerDip, outer.height - header);
  return { outer: clone(outer), content: { x: outer.x, y: outer.y + header,
    width: outer.width, height: Math.max(0, outer.height - header - footer) }, z };
}

/** Pure workspace preferences and transient geometry. Runtime effects belong to the root controller. */
export class WorkspaceModel implements WorkspaceModelApi {
  private state: WorkspaceSnapshot;
  private canvas: Canvas;
  private selected: RoomId | undefined;
  private zoomed: RoomId | undefined;
  private native: RoomId | undefined;
  private undo: LayoutState[] = [];
  private gesture: Gesture | undefined;

  constructor(snapshot: WorkspaceSnapshot, canvas: Canvas) {
    this.canvas = validateCanvas(canvas);
    this.state = checkedSnapshot(snapshot);
    if (this.state.layout.editing === 'free') this.completeFreeRects();
    this.baseGeometry();
  }
  get snapshot(): WorkspaceSnapshot { return clone(this.state); }
  get selectedId(): RoomId | undefined { return this.selected; }
  get zoomedId(): RoomId | undefined { return this.zoomed; }
  get nativeRoomId(): RoomId | undefined { return this.native; }
  get undoAvailable(): boolean { return this.undo.length > 0; }
  get geometry(): LayoutResult {
    let result = this.baseGeometry();
    const gesture = this.gesture;
    if (gesture && !gesture.automatic && result.rooms[gesture.roomId]) {
      const preview = gesture.preview;
      const rects = { ...this.state.layout.free.rects, [gesture.roomId]: {
        x: preview.x / this.canvas.width, y: preview.y / this.canvas.height,
        width: preview.width / this.canvas.width, height: preview.height / this.canvas.height,
        z: result.rooms[gesture.roomId].z,
      } };
      result = this.baseGeometry(undefined, rects);
    }
    const overlays = [this.zoomed, this.native].filter((id): id is string => !!id && !!result.rooms[id]);
    if (overlays.length) {
      let top = Math.max(-1, ...result.order.map(id => result.rooms[id].z));
      if (top > Number.MAX_SAFE_INTEGER - overlays.length) {
        [...result.order].sort((a, b) => result.rooms[a].z - result.rooms[b].z)
          .forEach((id, index) => { result.rooms[id].z = index; });
        top = result.order.length - 1;
      }
      for (const id of overlays) result.rooms[id] = geometryFor({ x: 0, y: 0, ...this.canvas }, ++top);
    }
    return clone(result);
  }

  setCanvas(canvas: Canvas): void {
    this.canvas = validateCanvas(canvas);
    this.gesture = undefined;
  }
  addRoom(room: RoomConfig): void {
    validateRoom(room);
    if (this.state.rooms.some(existing => existing.id === room.id || existing.canonicalUrl === room.canonicalUrl)) {
      throw new TypeError('Room already exists in workspace');
    }
    this.state.rooms.push(clone(room));
    this.state.stableOrder.push(room.id);
    this.state.layout.equal.order.push(room.id);
    this.state.layout.focus.order.push(room.id);
    this.state.layout.primaryRoomId ??= room.id;
    this.structuralChange();
    if (this.state.layout.editing === 'free') this.completeFreeRects();
  }
  removeRoom(roomId: RoomId): void {
    const oldOrder = this.state.stableOrder;
    const oldIndex = oldOrder.indexOf(roomId);
    if (oldIndex < 0) return;
    const next = oldOrder.length > 1 ? oldOrder[(oldIndex + 1) % oldOrder.length] : undefined;
    this.state.rooms = this.state.rooms.filter(room => room.id !== roomId);
    this.state.stableOrder = oldOrder.filter(id => id !== roomId);
    this.state.layout.equal.order = this.state.layout.equal.order.filter(id => id !== roomId);
    this.state.layout.focus.order = this.state.layout.focus.order.filter(id => id !== roomId);
    delete this.state.layout.free.rects[roomId];
    if (this.state.layout.primaryRoomId === roomId) this.state.layout.primaryRoomId = next;
    if (this.selected === roomId) this.selected = undefined;
    if (this.zoomed === roomId) this.zoomed = undefined;
    if (this.native === roomId) this.native = undefined;
    this.structuralChange();
  }
  setAudioAllowed(allowed: ReadonlyMap<RoomId, boolean>): void {
    for (const value of allowed.values()) if (typeof value !== 'boolean') throw new TypeError('Invalid audio state');
    for (const room of this.state.rooms) {
      const value = allowed.get(room.id);
      if (value !== undefined) room.audio.allowed = value;
    }
  }
  replaceSnapshot(snapshot: WorkspaceSnapshot, preserveTransient = false): void {
    const next = checkedSnapshot(snapshot);
    const currentIds = new Set(this.state.rooms.map(room => room.id));
    if (preserveTransient && (next.rooms.length !== currentIds.size || next.rooms.some(room => !currentIds.has(room.id)))) {
      throw new TypeError('Transient state can only be preserved for the same room set');
    }
    this.state = next;
    if (!preserveTransient) {
      this.selected = this.zoomed = this.native = undefined;
      this.structuralChange();
    }
    if (this.state.layout.editing === 'free') this.completeFreeRects();
  }

  apply(command: AppCommand): boolean {
    switch (command.type) {
      case 'removeRoom': this.removeRoom(command.roomId); return true;
      case 'selectRoom': if (this.has(command.roomId)) this.selected = command.roomId; return true;
      case 'raiseRoom': this.raise(command.roomId); return true;
      case 'setPrimary':
        if (this.has(command.roomId)) this.changeLayout(() => { this.state.layout.primaryRoomId = command.roomId; });
        return true;
      case 'setTemplate':
        if (command.template !== 'equal' && command.template !== 'focus') throw new TypeError('Invalid layout template');
        this.changeLayout(() => { this.state.layout.base = command.template; this.state.layout.editing = 'auto'; });
        return true;
      case 'setFree': this.setFree(command.fromCurrent ?? false); return true;
      case 'arrange': this.arrange(); return true;
      case 'undoGeometry':
        this.gesture = undefined;
        if (this.undo.length) this.state.layout = this.undo.pop()!;
        return true;
      case 'setZoom':
        if (typeof command.enabled !== 'boolean') throw new TypeError('Invalid zoom state');
        if (this.has(command.roomId)) {
          this.gesture = undefined;
          if (command.enabled) this.zoomed = command.roomId;
          else if (this.zoomed === command.roomId) this.zoomed = undefined;
        }
        return true;
      case 'setNative':
        if (typeof command.enabled !== 'boolean') throw new TypeError('Invalid native state');
        if (this.has(command.roomId)) {
          this.gesture = undefined;
          if (command.enabled) this.native = command.roomId;
          else if (this.native === command.roomId) this.native = undefined;
        }
        return true;
      case 'setChat': {
        if (typeof command.visible !== 'boolean') throw new TypeError('Invalid chat visibility');
        const room = this.room(command.roomId);
        if (room) { room.chat.visible = command.visible; this.gesture = undefined; }
        return true;
      }
      case 'setAllChat':
        if (typeof command.visible !== 'boolean') throw new TypeError('Invalid chat visibility');
        for (const room of this.state.rooms) room.chat.visible = command.visible;
        this.gesture = undefined;
        return true;
      case 'setChatWidth': {
        if (!Number.isFinite(command.widthDip) || command.widthDip < 0 || command.widthDip > 16384) throw new RangeError('Chat width is out of range');
        const room = this.room(command.roomId);
        if (room) { room.chat.preferredWidthDip = command.widthDip; this.gesture = undefined; }
        return true;
      }
      case 'renameWorkspace':
        if (typeof command.name !== 'string' || !command.name.trim() || command.name.length > 256
          || /[\x00-\x1f\x7f]/.test(command.name)) throw new TypeError('Invalid workspace name');
        this.state.name = command.name.trim(); return true;
      case 'geometryBegin': this.begin(command); return true;
      case 'geometryDelta': this.delta(command); return true;
      case 'geometryEnd': this.end(command); return true;
      default: return false;
    }
  }

  private room(id: RoomId): RoomConfig | undefined { return this.state.rooms.find(room => room.id === id); }
  private has(id: RoomId): boolean { return !!this.room(id); }
  private structuralChange(): void { this.undo = []; this.gesture = undefined; }
  private remember(before: LayoutState): void {
    if (same(before, this.state.layout)) return;
    this.undo.push(clone(before));
    if (this.undo.length > UNDO_LIMIT) this.undo.shift();
  }
  private changeLayout(change: () => void): void {
    this.gesture = undefined;
    const before = clone(this.state.layout);
    change();
    this.remember(before);
  }
  private baseGeometry(template?: 'equal' | 'focus', freeRects = this.state.layout.free.rects): LayoutResult {
    const layout = this.state.layout;
    const mode = template ?? (layout.editing === 'free' ? 'free' : layout.base);
    return computeLayout({ canvas: this.canvas, roomIds: mode === 'free' ? this.state.stableOrder : layout[mode].order,
      template: mode, primaryRoomId: layout.primaryRoomId, primaryShare: layout.focus.primaryShare,
      chat: Object.fromEntries(this.state.rooms.map(room => [room.id, room.chat])),
      freeRects, chrome: CHROME });
  }
  private normal(outer: RectDip, z: number): NormalizedRect {
    if (!this.canvas.width || !this.canvas.height) return { x: 0, y: 0, width: 1, height: 1, z };
    return toNormalized(outer, this.canvas, z);
  }
  private completeFreeRects(): void {
    const result = this.baseGeometry();
    for (const id of result.order) {
      if (!Object.hasOwn(this.state.layout.free.rects, id)) {
        Object.defineProperty(this.state.layout.free.rects, id, { value: this.normal(result.rooms[id].outer, result.rooms[id].z),
          enumerable: true, writable: true, configurable: true });
      } else this.state.layout.free.rects[id].z = result.rooms[id].z;
    }
  }
  private seedFree(geometry: LayoutResult): void {
    this.state.layout.free.rects = Object.fromEntries(geometry.order.map(id => [id, this.normal(geometry.rooms[id].outer, geometry.rooms[id].z)]));
  }
  private setFree(fromCurrent: boolean): void {
    const current = this.baseGeometry();
    this.changeLayout(() => {
      if (fromCurrent || !Object.keys(this.state.layout.free.rects).length) {
        this.seedFree(current);
        this.state.layout.free.from = this.state.layout.base;
      }
      this.state.layout.editing = 'free';
      this.completeFreeRects();
    });
  }
  private arrange(): void {
    this.changeLayout(() => {
      if (this.state.layout.editing === 'free') {
        this.seedFree(this.baseGeometry(this.state.layout.base));
        this.state.layout.free.from = this.state.layout.base;
      } else this.state.layout[this.state.layout.base].order = [...this.state.stableOrder];
    });
  }
  private raise(id: RoomId): void {
    if (!this.has(id) || this.state.layout.editing !== 'free') return;
    this.changeLayout(() => {
      this.completeFreeRects();
      const rects = this.state.layout.free.rects;
      let top = Math.max(-1, ...this.state.stableOrder.map(roomId => rects[roomId].z));
      if (top === Number.MAX_SAFE_INTEGER) {
        [...this.state.stableOrder].sort((a, b) => rects[a].z - rects[b].z)
          .forEach((roomId, index) => { rects[roomId].z = index; });
        top = this.state.rooms.length - 1;
      }
      rects[id].z = top + 1;
    });
  }
  private begin(command: Extract<AppCommand, { type: 'geometryBegin' }>): void {
    if (typeof command.gestureId !== 'string' || (command.kind !== 'move' && command.kind !== 'resize')) throw new TypeError('Invalid gesture');
    if (!this.has(command.roomId) || !command.gestureId || !this.canvas.width || !this.canvas.height
      || this.zoomed || this.native || (command.kind === 'resize' && this.state.layout.editing !== 'free')) return;
    const original = this.baseGeometry().rooms[command.roomId].outer;
    this.gesture = { id: command.gestureId, roomId: command.roomId, kind: command.kind,
      original: clone(original), preview: clone(original), before: clone(this.state.layout),
      automatic: this.state.layout.editing === 'auto', dx: 0, dy: 0 };
  }
  private matches(command: { roomId: string; gestureId: string }): Gesture | undefined {
    return this.gesture?.id === command.gestureId && this.gesture.roomId === command.roomId
      && this.has(command.roomId) ? this.gesture : undefined;
  }
  private snapFreeRect(rect: RectDip, gesture: Gesture): RectDip {
    const geometry = this.baseGeometry();
    const neighbors = geometry.order.filter(id => id !== gesture.roomId).map(id => geometry.rooms[id].outer);
    const horizontal = neighbors.filter(other => adjacentSpan(rect.y, rect.height, other.y, other.height));
    const vertical = neighbors.filter(other => adjacentSpan(rect.x, rect.width, other.x, other.width));
    if (gesture.kind === 'move') {
      const xs = [0, this.canvas.width - rect.width];
      const ys = [0, this.canvas.height - rect.height];
      for (const other of horizontal) {
        for (const edge of [other.x, other.x + other.width]) xs.push(edge, edge - rect.width);
      }
      for (const other of vertical) {
        for (const edge of [other.y, other.y + other.height]) ys.push(edge, edge - rect.height);
      }
      return { ...rect,
        x: gesture.dx === 0 ? rect.x : nearestSnap(rect.x, xs, 0, this.canvas.width - Math.min(96, rect.width)),
        y: gesture.dy === 0 ? rect.y : nearestSnap(rect.y, ys, 0, this.canvas.height - Math.min(CHROME.headerDip, rect.height)),
      };
    }
    // The frozen gesture contract resizes from the bottom/right handle only.
    const widths = [this.canvas.width - rect.x];
    const heights = [this.canvas.height - rect.y];
    for (const other of horizontal) widths.push(other.x - rect.x, other.x + other.width - rect.x);
    for (const other of vertical) heights.push(other.y - rect.y, other.y + other.height - rect.y);
    return { ...rect,
      width: gesture.dx === 0 ? rect.width : nearestSnap(rect.width, widths, Math.min(CHROME.minWidthDip, this.canvas.width), this.canvas.width),
      height: gesture.dy === 0 ? rect.height : nearestSnap(rect.height, heights, Math.min(CHROME.minHeightDip, this.canvas.height), this.canvas.height),
    };
  }
  private delta(command: Extract<AppCommand, { type: 'geometryDelta' }>): void {
    const gesture = this.matches(command);
    if (!gesture) return;
    if (!Number.isFinite(command.dx) || !Number.isFinite(command.dy)) throw new RangeError('Gesture delta must be finite');
    gesture.dx = command.dx; gesture.dy = command.dy;
    if (gesture.automatic) return;
    const original = gesture.original;
    const raw = gesture.kind === 'move'
      ? { ...original, x: original.x + command.dx, y: original.y + command.dy }
      : { ...original, width: clamp(original.width + command.dx, Math.min(CHROME.minWidthDip, this.canvas.width), this.canvas.width),
        height: clamp(original.height + command.dy, Math.min(CHROME.minHeightDip, this.canvas.height), this.canvas.height) };
    // Positive persistence coordinates and a visible title handle avoid a jump at commit.
    const x = clamp(raw.x, 0, Math.max(0, this.canvas.width - Math.min(96, raw.width)));
    const y = clamp(raw.y, 0, Math.max(0, this.canvas.height - Math.min(CHROME.headerDip, raw.height)));
    const snapped = this.snapFreeRect({ ...raw, x, y }, gesture);
    gesture.preview = recoverFreeRect({ x: snapped.x / this.canvas.width, y: snapped.y / this.canvas.height,
      width: snapped.width / this.canvas.width, height: snapped.height / this.canvas.height, z: 0 }, this.canvas, CHROME);
  }
  private end(command: Extract<AppCommand, { type: 'geometryEnd' }>): void {
    const gesture = this.matches(command);
    if (!gesture) return;
    this.gesture = undefined;
    if (!gesture.automatic) {
      if (same(gesture.original, gesture.preview)) return;
      this.state.layout.free.rects[gesture.roomId] = this.normal(gesture.preview, this.baseGeometry().rooms[gesture.roomId].z);
      this.remember(gesture.before);
      return;
    }
    const center = { x: gesture.original.x + gesture.original.width / 2 + gesture.dx,
      y: gesture.original.y + gesture.original.height / 2 + gesture.dy };
    const base = this.baseGeometry();
    const target = base.order.find(id => {
      const rect = base.rooms[id].outer;
      return id !== gesture.roomId && center.x >= rect.x && center.x <= rect.x + rect.width
        && center.y >= rect.y && center.y <= rect.y + rect.height;
    });
    if (!target) return;
    const layout = this.state.layout;
    const order = layout[layout.base].order;
    const first = order.indexOf(gesture.roomId), second = order.indexOf(target);
    [order[first], order[second]] = [order[second], order[first]];
    if (layout.base === 'focus') {
      const primary = layout.primaryRoomId ?? order[0];
      if (primary === gesture.roomId) layout.primaryRoomId = target;
      else if (primary === target) layout.primaryRoomId = gesture.roomId;
    }
    this.remember(gesture.before);
  }
}
