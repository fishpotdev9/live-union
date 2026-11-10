import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkspaceModel } from '../../../src/domain/workspace/index.ts';
import type { RectDip, WorkspaceSnapshot } from '../../../src/shared/contracts.ts';

const CANVAS = { width: 1000, height: 800 };
const FIRST: RectDip = { x: 100, y: 100, width: 250, height: 200 };
function model(other: RectDip = { x: 500, y: 100, width: 300, height: 300 }): WorkspaceModel {
  const state: WorkspaceSnapshot = {
    schemaVersion: 1, id: 'workspace', name: 'Snapping', stableOrder: ['a', 'b'],
    rooms: ['a', 'b'].map(id => ({ id, platform: 'huya', platformRoomId: id, canonicalUrl: `https://www.huya.com/${id}`,
      chat: { visible: false, preferredWidthDip: 280 }, audio: { allowed: id === 'a' } })),
    layout: { base: 'equal', editing: 'free', primaryRoomId: 'a',
      equal: { variant: 'auto', order: ['a', 'b'] }, focus: { variant: 'auto', order: ['a', 'b'] },
      free: { from: 'equal', rects: Object.fromEntries([FIRST, other].map((rect, index) => [index ? 'b' : 'a', {
        x: rect.x / CANVAS.width, y: rect.y / CANVAS.height, width: rect.width / CANVAS.width,
        height: rect.height / CANVAS.height, z: index,
      }])) } },
  };
  return new WorkspaceModel(state, CANVAS);
}
function begin(value: WorkspaceModel, kind: 'move' | 'resize' = 'move'): void {
  value.apply({ type: 'geometryBegin', roomId: 'a', gestureId: 'snap', kind });
}
function delta(value: WorkspaceModel, dx: number, dy: number): RectDip {
  value.apply({ type: 'geometryDelta', roomId: 'a', gestureId: 'snap', dx, dy });
  return value.geometry.rooms.a.outer;
}
function close(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }

test('free move snaps each canvas edge at 8 DIP inclusive and leaves positions outside the threshold alone', () => {
  for (const distance of [0, 7, 8, 8.01]) {
    const inside = distance <= 8;
    const left = model(); begin(left); close(delta(left, distance - FIRST.x, 0).x, inside ? 0 : distance);
    const top = model(); begin(top); close(delta(top, 0, distance - FIRST.y).y, inside ? 0 : distance);
    const right = model(); begin(right);
    close(delta(right, CANVAS.width - FIRST.width - FIRST.x - distance, 0).x, CANVAS.width - FIRST.width - (inside ? 0 : distance));
    const bottom = model(); begin(bottom);
    close(delta(bottom, 0, CANVAS.height - FIRST.height - FIRST.y - distance).y, CANVAS.height - FIRST.height - (inside ? 0 : distance));
  }
});

test('free move aligns either horizontal/vertical room edge while allowing same-edge overlap', () => {
  const leftTouch = model(); begin(leftTouch); close(delta(leftTouch, 143, 0).x + FIRST.width, 500);
  const rightAlign = model(); begin(rightAlign); close(delta(rightAlign, 443, 0).x + FIRST.width, 800);
  const overlap = model(); begin(overlap);
  const aligned = delta(overlap, 393, 0); close(aligned.x, 500);
  assert.ok(aligned.x < overlap.geometry.rooms.b.outer.x + overlap.geometry.rooms.b.outer.width);
  assert.ok(aligned.x + aligned.width > overlap.geometry.rooms.b.outer.x);
  const vertical = model({ x: 100, y: 400, width: 300, height: 300 }); begin(vertical);
  close(delta(vertical, 0, 93).y + FIRST.height, 400);
  close(delta(vertical, 0, 393).y + FIRST.height, 700);
  close(delta(vertical, 0, 293).y, 400);
});

test('free resize snaps bottom/right handles to canvas and adjacent edges without moving the anchor', () => {
  const edge = model(); begin(edge, 'resize');
  const canvas = delta(edge, 643, 493);
  close(canvas.x, FIRST.x); close(canvas.y, FIRST.y);
  close(canvas.x + canvas.width, CANVAS.width); close(canvas.y + canvas.height, CANVAS.height);
  const horizontal = model(); begin(horizontal, 'resize');
  close(delta(horizontal, 143, 0).width, 400);
  close(delta(horizontal, 443, 0).width, 700);
  const vertical = model({ x: 100, y: 400, width: 300, height: 300 }); begin(vertical, 'resize');
  close(delta(vertical, 0, 93).height, 300);
  close(delta(vertical, 0, 393).height, 600);
  const outside = model(); begin(outside, 'resize'); close(delta(outside, 140, 0).width, 390);
});

test('neighbor snapping requires nearby perpendicular spans and does not change an untouched axis', () => {
  const far = model({ x: 500, y: 500, width: 300, height: 200 }); begin(far);
  close(delta(far, 143, 0).x, 243);
  const farResize = model({ x: 500, y: 500, width: 300, height: 200 }); begin(farResize, 'resize');
  close(delta(farResize, 143, 0).width, 393);
  const value = model();
  const saved = value.snapshot;
  saved.layout.free.rects.a.y = 0.004;
  value.replaceSnapshot(saved); begin(value);
  close(delta(value, 25, 0).y, 3.2);
});

test('snap previews remain absolute, persist only at end, and undo keeps audio/chat and neighboring geometry', () => {
  const value = model();
  const before = value.snapshot;
  const neighbor = value.geometry.rooms.b;
  begin(value);
  close(delta(value, 143, 0).x, 250);
  close(delta(value, 100, 0).x, 200);
  close(delta(value, 143, 0).x, 250);
  assert.deepEqual(value.snapshot, before);
  value.apply({ type: 'geometryEnd', roomId: 'a', gestureId: 'snap' });
  close(value.geometry.rooms.a.outer.x, 250);
  assert.deepEqual(value.geometry.rooms.b, neighbor);
  assert.deepEqual(value.snapshot.rooms, before.rooms);
  value.apply({ type: 'undoGeometry' });
  close(value.geometry.rooms.a.outer.x, FIRST.x);
  const resizing = model(); begin(resizing, 'resize');
  close(delta(resizing, 143, 0).width, 400);
  close(delta(resizing, 100, 0).width, 350);
});

test('snapping respects minimum dimensions and keeps a title handle reachable on tiny canvases', () => {
  const value = model({ x: 315, y: 100, width: 300, height: 300 }); begin(value, 'resize');
  close(delta(value, -28, 0).width, 222); // 215-DIP snap target would violate the 220-DIP minimum.
  const tiny = model(); tiny.setCanvas({ width: 120, height: 90 }); begin(tiny, 'resize');
  const resized = delta(tiny, -1e200, -1e200);
  close(resized.width, 120); close(resized.height, 90);
  tiny.apply({ type: 'geometryEnd', roomId: 'a', gestureId: 'snap' }); begin(tiny);
  const moved = delta(tiny, 1e200, 1e200);
  assert.ok(moved.x + Math.min(96, moved.width) <= 120);
  assert.ok(moved.y + Math.min(36, moved.height) <= 90);
});
