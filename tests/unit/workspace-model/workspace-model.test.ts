import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkspaceModel } from '../../../src/domain/workspace/index.ts';
import { UI_METRICS } from '../../../src/shared/app-contracts.ts';
import type { AppCommand } from '../../../src/shared/app-contracts.ts';
import type { RectDip, RoomConfig, WorkspaceSnapshot } from '../../../src/shared/contracts.ts';

const CANVAS = { width: 1800, height: 1000 };
const id = (index: number): string => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
function room(index: number): RoomConfig {
  return { id: id(index), platform: 'huya', platformRoomId: `test${index + 1}`,
    canonicalUrl: `https://www.huya.com/test${index + 1}`,
    chat: { visible: false, preferredWidthDip: 280 }, audio: { allowed: index % 2 === 0, preferredVolume: 0.5 } };
}
function snapshot(count: number): WorkspaceSnapshot {
  const rooms = Array.from({ length: count }, (_, index) => room(index));
  const order = rooms.map(item => item.id);
  return { schemaVersion: 1, id: '10000000-0000-4000-8000-000000000000', name: 'Test workspace', rooms, stableOrder: [...order],
    layout: { base: 'equal', editing: 'auto', primaryRoomId: order[0],
      equal: { variant: 'auto', order: [...order] }, focus: { variant: 'auto', order: [...order], primaryShare: 0.64 },
      free: { rects: {}, from: 'equal' } } };
}
function freeSnapshot(): WorkspaceSnapshot {
  const value = snapshot(2);
  value.layout.editing = 'free';
  value.layout.free.rects = {
    [id(0)]: { x: 0.1, y: 0.1, width: 0.3, height: 0.3, z: 3 },
    [id(1)]: { x: 0.6, y: 0.4, width: 0.3, height: 0.4, z: 7 },
  };
  return value;
}
function approximately(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= 1e-7, `${actual} should equal ${expected}`);
}
function rectEqual(actual: RectDip, expected: RectDip): void {
  for (const key of ['x', 'y', 'width', 'height'] as const) approximately(actual[key], expected[key]);
}
function audio(model: WorkspaceModel): boolean[] { return model.snapshot.rooms.map(value => value.audio.allowed); }
function drag(model: WorkspaceModel, roomId: string, dx: number, dy: number, kind: 'move' | 'resize' = 'move', gestureId = 'drag'): void {
  model.apply({ type: 'geometryBegin', roomId, gestureId, kind });
  model.apply({ type: 'geometryDelta', roomId, gestureId, dx, dy });
  model.apply({ type: 'geometryEnd', roomId, gestureId });
}

test('natural add/remove from 0 through 9 covers 5/6/7 and cleans every order/rect', () => {
  const model = new WorkspaceModel(snapshot(0), CANVAS);
  for (let count = 0; count <= 9; count++) {
    if (count) model.addRoom(room(count - 1));
    const state = model.snapshot;
    assert.equal(state.rooms.length, count);
    assert.equal(Object.keys(model.geometry.rooms).length, count);
    assert.deepEqual(state.stableOrder, state.rooms.map(value => value.id));
    assert.deepEqual(state.layout.equal.order, state.stableOrder);
    assert.deepEqual(state.layout.focus.order, state.stableOrder);
  }
  model.apply({ type: 'setFree' });
  for (let count = 9; count > 0; count--) {
    const removed = id(count - 1);
    model.removeRoom(removed);
    const state = model.snapshot;
    assert.equal(state.rooms.length, count - 1);
    assert.ok(!Object.hasOwn(state.layout.free.rects, removed));
    assert.ok(!state.stableOrder.includes(removed) && !state.layout.equal.order.includes(removed) && !state.layout.focus.order.includes(removed));
    assert.equal(Object.keys(model.geometry.rooms).length, count - 1);
  }
  assert.equal(model.snapshot.layout.primaryRoomId, undefined);
});

test('add rejects duplicate IDs and canonical URLs without changing state', () => {
  const model = new WorkspaceModel(snapshot(2), CANVAS);
  const before = model.snapshot;
  assert.throws(() => model.addRoom(room(0)), /already exists/);
  assert.throws(() => model.addRoom({ ...room(2), canonicalUrl: room(1).canonicalUrl }), /already exists/);
  assert.deepEqual(model.snapshot, before);
});

test('deleting main chooses its next old stable neighbor and wraps at the end without opening audio', () => {
  for (const primary of [0, 2, 3, 5]) {
    const value = snapshot(6);
    value.stableOrder = [id(1), id(4), id(0), id(5), id(2), id(3)];
    value.layout.primaryRoomId = id(primary);
    const oldIndex = value.stableOrder.indexOf(id(primary));
    const next = value.stableOrder[(oldIndex + 1) % value.stableOrder.length];
    const expectedAudio = value.rooms.filter(item => item.id !== id(primary)).map(item => item.audio.allowed);
    const model = new WorkspaceModel(value, CANVAS);
    model.removeRoom(id(primary));
    assert.equal(model.snapshot.layout.primaryRoomId, next);
    assert.deepEqual(audio(model), expectedAudio);
  }
  const model = new WorkspaceModel(snapshot(1), CANVAS);
  model.removeRoom(id(0));
  assert.equal(model.snapshot.layout.primaryRoomId, undefined);
});

test('each auto template uses its own stable order rather than stableOrder', () => {
  const value = snapshot(6);
  value.layout.equal.order.reverse();
  value.layout.focus.order = [id(2), id(3), id(4), id(5), id(0), id(1)];
  const model = new WorkspaceModel(value, CANVAS);
  assert.deepEqual(model.geometry.order, value.layout.equal.order);
  model.apply({ type: 'setTemplate', template: 'focus' });
  assert.deepEqual(model.geometry.order, value.layout.focus.order);
  model.apply({ type: 'setTemplate', template: 'equal' });
  assert.deepEqual(model.geometry.order, value.layout.equal.order);
});

test('free geometry survives auto templates and can explicitly seed again from current template', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const manual = model.geometry;
  const saved = model.snapshot.layout.free;
  model.apply({ type: 'setTemplate', template: 'focus' });
  model.apply({ type: 'setTemplate', template: 'equal' });
  const equal = model.geometry;
  model.apply({ type: 'setFree' });
  assert.deepEqual(model.snapshot.layout.free, saved);
  assert.deepEqual(model.geometry, manual);
  model.apply({ type: 'setTemplate', template: 'equal' });
  model.apply({ type: 'setFree', fromCurrent: true });
  for (const roomId of equal.order) rectEqual(model.geometry.rooms[roomId].outer, equal.rooms[roomId].outer);
  assert.notDeepEqual(model.snapshot.layout.free, saved);
});

test('first free entry seeds from the current template and UI chrome occupies the same-page content area', () => {
  const model = new WorkspaceModel(snapshot(5), CANVAS);
  model.apply({ type: 'setTemplate', template: 'focus' });
  const before = model.geometry;
  model.apply({ type: 'setFree' });
  assert.equal(model.snapshot.layout.free.from, 'focus');
  for (const roomId of before.order) {
    const geometry = model.geometry.rooms[roomId];
    rectEqual(geometry.outer, before.rooms[roomId].outer);
    assert.equal(geometry.content.width, geometry.outer.width);
    approximately(geometry.content.y, geometry.outer.y + UI_METRICS.headerDip);
    approximately(geometry.content.height, geometry.outer.height - UI_METRICS.headerDip - UI_METRICS.footerDip);
  }
});

test('free addition preserves manual geometry and remains complete even on a zero-sized canvas', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const before = model.snapshot.layout.free.rects;
  model.addRoom(room(2));
  for (const roomId of Object.keys(before)) assert.deepEqual(model.snapshot.layout.free.rects[roomId], before[roomId]);
  assert.ok(Object.hasOwn(model.snapshot.layout.free.rects, id(2)));
  model.setCanvas({ width: 0, height: 0 });
  model.addRoom(room(3));
  assert.equal(Object.keys(model.snapshot.layout.free.rects).length, 4);
  assert.ok(model.snapshot.layout.free.rects[id(3)].width > 0);
  model.setCanvas(CANVAS);
  assert.equal(Object.keys(model.geometry.rooms).length, 4);
});

test('zoom and native overlays keep other rooms and restore the exact underlying geometry independently', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const bottom = model.geometry;
  const saved = model.snapshot;
  model.apply({ type: 'setZoom', roomId: id(0), enabled: true });
  rectEqual(model.geometry.rooms[id(0)].outer, { x: 0, y: 0, ...CANVAS });
  rectEqual(model.geometry.rooms[id(1)].outer, bottom.rooms[id(1)].outer);
  model.apply({ type: 'setNative', roomId: id(1), enabled: true });
  assert.equal(Object.keys(model.geometry.rooms).length, 2);
  assert.ok(model.geometry.rooms[id(1)].z > model.geometry.rooms[id(0)].z);
  model.apply({ type: 'setNative', roomId: id(1), enabled: false });
  assert.equal(model.zoomedId, id(0));
  rectEqual(model.geometry.rooms[id(0)].outer, { x: 0, y: 0, ...CANVAS });
  model.apply({ type: 'setZoom', roomId: id(0), enabled: false });
  assert.deepEqual(model.geometry, bottom);
  assert.deepEqual(model.snapshot, saved);
});

test('layout/selection/raise/zoom/native and chat commands never change audio intent', () => {
  const model = new WorkspaceModel(snapshot(7), CANVAS);
  const original = audio(model);
  const commands: AppCommand[] = [
    { type: 'selectRoom', roomId: id(2) }, { type: 'setPrimary', roomId: id(4) },
    { type: 'setTemplate', template: 'focus' }, { type: 'setFree' }, { type: 'raiseRoom', roomId: id(3) },
    { type: 'setZoom', roomId: id(0), enabled: true }, { type: 'setNative', roomId: id(1), enabled: true },
    { type: 'setZoom', roomId: id(0), enabled: false }, { type: 'setNative', roomId: id(1), enabled: false },
    { type: 'setChat', roomId: id(0), visible: true }, { type: 'setAllChat', visible: true },
    { type: 'setChatWidth', roomId: id(1), widthDip: 400 }, { type: 'arrange' }, { type: 'undoGeometry' },
  ];
  for (const command of commands) {
    assert.equal(model.apply(command), true);
    assert.deepEqual(audio(model), original, command.type);
  }
  assert.equal(model.selectedId, id(2));
  model.setAudioAllowed(new Map([[id(0), false], [id(1), true], ['unknown', true]]));
  assert.deepEqual(audio(model), [false, true, true, false, true, false, true]);
  assert.equal(model.snapshot.rooms[0].audio.preferredVolume, 0.5);
});

test('chat and rename preferences survive geometry undo', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const before = model.geometry;
  drag(model, id(0), 80, 50);
  model.apply({ type: 'setChat', roomId: id(0), visible: true });
  model.apply({ type: 'setChatWidth', roomId: id(0), widthDip: 350 });
  model.setAudioAllowed(new Map([[id(0), false], [id(1), true]]));
  model.apply({ type: 'renameWorkspace', name: '  Saved views  ' });
  model.apply({ type: 'undoGeometry' });
  rectEqual(model.geometry.rooms[id(0)].outer, before.rooms[id(0)].outer);
  assert.deepEqual(model.snapshot.rooms[0].chat, { visible: true, preferredWidthDip: 350 });
  assert.deepEqual(audio(model), [false, true]);
  assert.equal(model.snapshot.name, 'Saved views');
});

test('arrange free writes the current base template, and undo restores manual geometry', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const before = model.geometry;
  model.apply({ type: 'arrange' });
  assert.equal(model.snapshot.layout.editing, 'free');
  assert.notDeepEqual(model.geometry.rooms[id(0)].outer, before.rooms[id(0)].outer);
  model.apply({ type: 'undoGeometry' });
  assert.deepEqual(model.geometry, before);
  const value = snapshot(3);
  value.layout.equal.order.reverse();
  const auto = new WorkspaceModel(value, CANVAS);
  auto.apply({ type: 'arrange' });
  assert.deepEqual(auto.geometry.order, value.stableOrder);
  auto.apply({ type: 'undoGeometry' });
  assert.deepEqual(auto.geometry.order, value.layout.equal.order);
});

test('undo retains at most 30 geometry checkpoints and structural changes cannot resurrect closed rooms', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  for (let index = 0; index < 40; index++) model.apply({ type: 'raiseRoom', roomId: id(index % 2) });
  let undos = 0;
  while (model.undoAvailable) { model.apply({ type: 'undoGeometry' }); undos++; }
  assert.equal(undos, 30);
  drag(model, id(0), 50, 10);
  assert.equal(model.undoAvailable, true);
  model.removeRoom(id(0));
  assert.equal(model.undoAvailable, false);
  model.apply({ type: 'undoGeometry' });
  assert.equal(model.snapshot.rooms.length, 1);
  assert.ok(!Object.hasOwn(model.snapshot.layout.free.rects, id(0)));
  model.addRoom(room(2));
  assert.equal(model.undoAvailable, false);
});

test('free movement uses absolute deltas, previews only geometry, then commits normalized state once', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const original = model.geometry.rooms[id(0)].outer;
  const saved = model.snapshot;
  model.apply({ type: 'geometryBegin', roomId: id(0), gestureId: 'move', kind: 'move' });
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'move', dx: 20, dy: 10 });
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'move', dx: 50, dy: 30 });
  rectEqual(model.geometry.rooms[id(0)].outer, { ...original, x: original.x + 50, y: original.y + 30 });
  assert.deepEqual(model.snapshot, saved);
  assert.equal(model.undoAvailable, false);
  model.apply({ type: 'geometryEnd', roomId: id(0), gestureId: 'move' });
  approximately(model.snapshot.layout.free.rects[id(0)].x, (original.x + 50) / CANVAS.width);
  assert.equal(model.undoAvailable, true);
  model.apply({ type: 'undoGeometry' });
  rectEqual(model.geometry.rooms[id(0)].outer, original);
});

test('resize is absolute and constrained by UI minimums/current canvas, with title recovery for movement', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const original = model.geometry.rooms[id(0)].outer;
  model.apply({ type: 'geometryBegin', roomId: id(0), gestureId: 'size', kind: 'resize' });
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'size', dx: 10, dy: 5 });
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'size', dx: 40, dy: 20 });
  approximately(model.geometry.rooms[id(0)].outer.width, original.width + 40);
  approximately(model.geometry.rooms[id(0)].outer.height, original.height + 20);
  model.apply({ type: 'geometryEnd', roomId: id(0), gestureId: 'size' });
  drag(model, id(0), -1e200, -1e200, 'resize');
  assert.equal(model.geometry.rooms[id(0)].outer.width, 220);
  assert.equal(model.geometry.rooms[id(0)].outer.height, 120);
  drag(model, id(0), 1e200, 1e200, 'resize');
  assert.equal(model.geometry.rooms[id(0)].outer.width, CANVAS.width);
  assert.equal(model.geometry.rooms[id(0)].outer.height, CANVAS.height);
  drag(model, id(0), 1e200, 1e200);
  const moved = model.geometry.rooms[id(0)].outer;
  assert.ok(moved.x + 96 <= CANVAS.width && moved.y + 36 <= CANVAS.height);
  model.setCanvas({ width: 120, height: 90 });
  drag(model, id(0), -1e200, -1e200, 'resize');
  assert.equal(model.geometry.rooms[id(0)].outer.width, 120);
  assert.equal(model.geometry.rooms[id(0)].outer.height, 90);
});

test('auto move swaps positions only at center hit and auto resize does nothing', () => {
  const model = new WorkspaceModel(snapshot(6), CANVAS);
  const before = model.snapshot;
  const source = model.geometry.rooms[id(0)].outer, target = model.geometry.rooms[id(4)].outer;
  const dx = target.x + target.width / 2 - source.x - source.width / 2;
  const dy = target.y + target.height / 2 - source.y - source.height / 2;
  model.apply({ type: 'geometryBegin', roomId: id(0), gestureId: 'swap', kind: 'move' });
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'swap', dx, dy });
  assert.deepEqual(model.snapshot, before);
  rectEqual(model.geometry.rooms[id(0)].outer, source);
  model.apply({ type: 'geometryEnd', roomId: id(0), gestureId: 'swap' });
  assert.equal(model.snapshot.layout.equal.order[4], id(0));
  assert.equal(model.snapshot.layout.equal.order[0], id(4));
  rectEqual(model.geometry.rooms[id(0)].outer, target);
  assert.deepEqual(model.snapshot.layout.focus.order, before.layout.focus.order);
  const swapped = model.snapshot;
  drag(model, id(0), 100, 100, 'resize');
  assert.deepEqual(model.snapshot, swapped);
  drag(model, id(0), -1e200, -1e200);
  assert.deepEqual(model.snapshot, swapped);
});

test('focus main/secondary swapping changes main semantics and preserves audio', () => {
  for (const fromMain of [true, false]) {
    const model = new WorkspaceModel(snapshot(5), CANVAS);
    model.apply({ type: 'setTemplate', template: 'focus' });
    const sourceId = fromMain ? id(0) : id(3), targetId = fromMain ? id(3) : id(0);
    const source = model.geometry.rooms[sourceId].outer, target = model.geometry.rooms[targetId].outer;
    const beforeAudio = audio(model);
    drag(model, sourceId, target.x + target.width / 2 - source.x - source.width / 2,
      target.y + target.height / 2 - source.y - source.height / 2);
    assert.equal(model.snapshot.layout.primaryRoomId, id(3));
    rectEqual(model.geometry.rooms[id(3)].outer, fromMain ? source : target);
    assert.deepEqual(audio(model), beforeAudio);
  }
});

test('stale/foreign gestures, removed rooms and resize events cannot apply an obsolete preview', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const before = model.snapshot;
  model.apply({ type: 'geometryBegin', roomId: id(0), gestureId: 'first', kind: 'move' });
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'wrong', dx: 999, dy: 999 });
  model.apply({ type: 'geometryEnd', roomId: id(1), gestureId: 'first' });
  assert.deepEqual(model.snapshot, before);
  model.apply({ type: 'geometryBegin', roomId: id(1), gestureId: 'second', kind: 'move' });
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'first', dx: 999, dy: 999 });
  model.apply({ type: 'geometryEnd', roomId: id(0), gestureId: 'first' });
  model.apply({ type: 'geometryDelta', roomId: id(1), gestureId: 'second', dx: 10, dy: 10 });
  model.setCanvas({ width: 1700, height: 900 });
  model.apply({ type: 'geometryEnd', roomId: id(1), gestureId: 'second' });
  assert.deepEqual(model.snapshot, before);
  assert.equal(model.undoAvailable, false);
  model.apply({ type: 'geometryBegin', roomId: id(0), gestureId: 'deleted', kind: 'move' });
  model.removeRoom(id(0));
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'deleted', dx: 100, dy: 100 });
  model.apply({ type: 'geometryEnd', roomId: id(0), gestureId: 'deleted' });
  assert.equal(model.snapshot.rooms.length, 1);
});

test('canvas resizing preserves relative save data and creates no undo checkpoints', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const saved = model.snapshot;
  for (const scale of [1, 1.25, 1.5, 2]) {
    const canvas = { width: 3840 / scale, height: 2160 / scale - 128 };
    model.setCanvas(canvas);
    const rect = model.geometry.rooms[id(0)].outer;
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + 96 <= canvas.width && rect.y + 36 <= canvas.height);
    assert.deepEqual(model.snapshot, saved);
    assert.equal(model.undoAvailable, false);
  }
});

test('raise and overlays safely compact exhausted z without changing saved bounds or audio', () => {
  const value = freeSnapshot();
  value.layout.free.rects[id(0)].z = Number.MAX_SAFE_INTEGER;
  const model = new WorkspaceModel(value, CANVAS);
  const savedRects = model.snapshot.layout.free.rects;
  const savedAudio = audio(model);
  model.apply({ type: 'setZoom', roomId: id(1), enabled: true });
  assert.ok(Number.isSafeInteger(model.geometry.rooms[id(1)].z));
  assert.ok(model.geometry.rooms[id(1)].z > model.geometry.rooms[id(0)].z);
  assert.deepEqual(model.snapshot.layout.free.rects, savedRects);
  model.apply({ type: 'setZoom', roomId: id(1), enabled: false });
  model.apply({ type: 'raiseRoom', roomId: id(1) });
  const rects = model.snapshot.layout.free.rects;
  assert.ok(rects[id(1)].z > rects[id(0)].z);
  for (const roomId of Object.keys(rects)) {
    assert.ok(Number.isSafeInteger(rects[roomId].z));
    for (const key of ['x', 'y', 'width', 'height'] as const) assert.equal(rects[roomId][key], savedRects[roomId][key]);
  }
  assert.deepEqual(audio(model), savedAudio);
});

test('snapshot replacement clears transients by default, save-as can preserve the same room set', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  model.apply({ type: 'selectRoom', roomId: id(0) });
  model.apply({ type: 'raiseRoom', roomId: id(0) });
  model.apply({ type: 'setZoom', roomId: id(0), enabled: true });
  model.apply({ type: 'setNative', roomId: id(1), enabled: true });
  const geometry = model.geometry;
  const savedAs = model.snapshot;
  savedAs.id = '20000000-0000-4000-8000-000000000000'; savedAs.name = 'Saved as';
  model.replaceSnapshot(savedAs, true);
  assert.equal(model.selectedId, id(0)); assert.equal(model.zoomedId, id(0)); assert.equal(model.nativeRoomId, id(1));
  assert.equal(model.undoAvailable, true);
  assert.deepEqual(model.geometry, geometry);
  assert.throws(() => model.replaceSnapshot(snapshot(3), true), /same room set/);
  assert.deepEqual(model.snapshot, savedAs);
  model.replaceSnapshot(snapshot(3));
  assert.equal(model.selectedId, undefined); assert.equal(model.zoomedId, undefined); assert.equal(model.nativeRoomId, undefined);
  assert.equal(model.undoAvailable, false);
  assert.equal(model.snapshot.rooms.length, 3);
});

test('constructor, snapshots, geometry and replacement snapshots are defensive copies', () => {
  const value = freeSnapshot();
  const model = new WorkspaceModel(value, CANVAS);
  const expected = model.snapshot;
  value.rooms[0].audio.allowed = false; value.layout.free.rects[id(0)].x = 0.9;
  const copy = model.snapshot;
  copy.rooms[0].chat.visible = true; copy.stableOrder.reverse(); copy.layout.free.rects[id(0)].z = 999;
  const geometry = model.geometry;
  geometry.rooms[id(0)].outer.x = 999; geometry.order.reverse();
  assert.deepEqual(model.snapshot, expected);
  const next = snapshot(5);
  model.replaceSnapshot(next);
  next.rooms.length = 0;
  assert.equal(model.snapshot.rooms.length, 5);
});

test('runtime, network, audio and catalog commands return false without state changes', () => {
  const model = new WorkspaceModel(snapshot(2), CANVAS);
  const before = model.snapshot;
  const commands: AppCommand[] = [
    { type: 'getState' }, { type: 'addRoom', url: 'https://www.huya.com/test3' },
    { type: 'reloadRoom', roomId: id(0) }, { type: 'soloAudio', roomId: id(0) },
    { type: 'setAudio', roomId: id(0), allowed: false }, { type: 'muteAll' }, { type: 'showRoomMenu', roomId: id(0) },
    { type: 'saveWorkspaceAs', name: 'Other' }, { type: 'openWorkspace', workspaceId: 'other' }, { type: 'toggleFullscreen' },
  ];
  for (const command of commands) {
    assert.equal(model.apply(command), false, command.type);
    assert.deepEqual(model.snapshot, before);
  }
});

test('finite/bounded command validation rejects bad values atomically and ignores obsolete targets', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  const before = model.snapshot;
  for (const value of [NaN, Infinity, -1]) assert.throws(() => model.setCanvas({ width: value, height: 200 }));
  for (const value of [NaN, Infinity, -1, 20000]) assert.throws(() => model.apply({ type: 'setChatWidth', roomId: id(0), widthDip: value }));
  for (const name of ['', '   ', 'a\nb', 'a'.repeat(257)]) assert.throws(() => model.apply({ type: 'renameWorkspace', name }));
  model.apply({ type: 'geometryBegin', roomId: id(0), gestureId: 'finite', kind: 'move' });
  assert.throws(() => model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'finite', dx: Infinity, dy: 0 }));
  model.apply({ type: 'geometryEnd', roomId: id(0), gestureId: 'finite' });
  for (const type of ['removeRoom', 'selectRoom', 'raiseRoom', 'setPrimary'] as const) model.apply({ type, roomId: 'deleted' });
  assert.deepEqual(model.snapshot, before);
});

test('preview readability warning and persisted free geometry agree after gesture end and reload', () => {
  const model = new WorkspaceModel(freeSnapshot(), CANVAS);
  model.apply({type:'setChat',roomId:id(0),visible:true});
  assert.equal(model.geometry.spaceConstrained, false);
  model.apply({ type: 'geometryBegin', roomId: id(0), gestureId: 'small', kind: 'resize' });
  model.apply({ type: 'geometryDelta', roomId: id(0), gestureId: 'small', dx: -999, dy: -999 });
  assert.equal(model.geometry.spaceConstrained, true);
  const preview = model.geometry;
  model.apply({ type: 'geometryEnd', roomId: id(0), gestureId: 'small' });
  assert.deepEqual(model.geometry, preview);
  const restored = new WorkspaceModel(JSON.parse(JSON.stringify(model.snapshot)) as WorkspaceSnapshot, CANVAS);
  assert.deepEqual(restored.geometry, model.geometry);
  assert.deepEqual(restored.snapshot, model.snapshot);
});

test('seeded mixed workspace commands retain valid room sets, finite geometry and independent audio', () => {
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const model = new WorkspaceModel(snapshot(4), CANVAS);
  const expectedAudio = new Map(model.snapshot.rooms.map(value => [value.id, value.audio.allowed]));
  let nextRoom = 4;
  for (let index = 0; index < 400; index++) {
    const state = model.snapshot;
    const target = state.stableOrder[Math.floor(random() * state.rooms.length)];
    const action = Math.floor(random() * 15);
    if (action === 0 && state.rooms.length < 9) {
      const added = room(nextRoom++); model.addRoom(added); expectedAudio.set(added.id, added.audio.allowed);
    } else if (action === 1 && target) { model.removeRoom(target); expectedAudio.delete(target); }
    else if (action === 2) model.apply({ type: 'setTemplate', template: random() < 0.5 ? 'equal' : 'focus' });
    else if (action === 3) model.apply({ type: 'setFree', fromCurrent: random() < 0.5 });
    else if (action === 4 && target) model.apply({ type: 'raiseRoom', roomId: target });
    else if (action === 5 && target) model.apply({ type: 'setPrimary', roomId: target });
    else if (action === 6) model.apply({ type: 'arrange' });
    else if (action === 7) model.apply({ type: 'undoGeometry' });
    else if (action === 8 && target) drag(model, target, random() * 1800 - 900, random() * 1000 - 500, random() < 0.5 ? 'move' : 'resize', `random-${index}`);
    else if (action === 9) model.setCanvas({ width: Math.floor(random() * 2000), height: Math.floor(random() * 1200) });
    else if (action === 10 && target) model.apply({ type: 'setZoom', roomId: target, enabled: random() < 0.5 });
    else if (action === 11 && target) model.apply({ type: 'setNative', roomId: target, enabled: random() < 0.5 });
    else if (action === 12 && target) model.apply({ type: 'setChat', roomId: target, visible: random() < 0.5 });
    else if (action === 13 && target) model.apply({ type: 'selectRoom', roomId: target });
    else if (action === 14 && target) {
      const allowed = random() < 0.5;
      model.setAudioAllowed(new Map([[target, allowed]])); expectedAudio.set(target, allowed);
    }
    const current = model.snapshot;
    const ids = new Set(current.rooms.map(value => value.id));
    for (const order of [current.stableOrder, current.layout.equal.order, current.layout.focus.order]) {
      assert.equal(order.length, ids.size); assert.deepEqual(new Set(order), ids);
    }
    for (const value of current.rooms) assert.equal(value.audio.allowed, expectedAudio.get(value.id));
    for (const [roomId, rect] of Object.entries(current.layout.free.rects)) {
      assert.ok(ids.has(roomId));
      assert.ok(rect.x >= 0 && rect.x <= 1 && rect.y >= 0 && rect.y <= 1);
      assert.ok(rect.width > 0 && rect.width <= 1 && rect.height > 0 && rect.height <= 1);
      assert.ok(Number.isSafeInteger(rect.z) && rect.z >= 0);
    }
    const geometry = model.geometry;
    assert.deepEqual(new Set(geometry.order), ids);
    for (const roomId of geometry.order) {
      for (const rect of [geometry.rooms[roomId].outer, geometry.rooms[roomId].content]) {
        assert.ok(Object.values(rect).every(Number.isFinite)); assert.ok(rect.width >= 0 && rect.height >= 0);
      }
      assert.ok(Number.isSafeInteger(geometry.rooms[roomId].z));
    }
  }
});
