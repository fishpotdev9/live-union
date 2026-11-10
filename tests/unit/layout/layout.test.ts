import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeLayout, recoverFreeRect, toNormalized } from '../../../src/domain/layout/index.ts';
import type { LayoutInput, LayoutResult, NormalizedRect, RectDip } from '../../../src/shared/contracts.ts';

const EPS = 1e-7;
function input(count: number, width = 1920, height = 1080, template: LayoutInput['template'] = 'equal'): LayoutInput {
  const roomIds = Array.from({ length: count }, (_, index) => `room-${index}`);
  return { canvas: { width, height }, roomIds, template, chat: {} };
}
function approximately(actual: number, expected: number, epsilon = EPS): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be near ${expected}`);
}
function assertRect(rect: RectDip): void {
  for (const value of Object.values(rect)) assert.ok(Number.isFinite(value));
  assert.ok(rect.width >= 0 && rect.height >= 0);
}
function intersects(a: RectDip, b: RectDip): boolean {
  return a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS
    && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;
}
function assertGeometry(value: LayoutInput, result: LayoutResult, automatic = true): void {
  assert.deepEqual(result.order, value.roomIds);
  assert.equal(Object.keys(result.rooms).length, value.roomIds.length);
  for (const id of value.roomIds) {
    const { outer, content, z } = result.rooms[id];
    assertRect(outer); assertRect(content); assert.ok(Number.isSafeInteger(z) && z >= 0);
    assert.ok(content.x >= outer.x - EPS && content.y >= outer.y - EPS);
    assert.ok(content.x + content.width <= outer.x + outer.width + EPS);
    assert.ok(content.y + content.height <= outer.y + outer.height + EPS);
    if (automatic) {
      assert.ok(outer.x >= -EPS && outer.y >= -EPS);
      assert.ok(outer.x + outer.width <= value.canvas.width + EPS);
      assert.ok(outer.y + outer.height <= value.canvas.height + EPS);
    }
  }
  if (automatic) for (let i = 0; i < value.roomIds.length; i++) for (let j = i + 1; j < value.roomIds.length; j++) {
    assert.ok(!intersects(result.rooms[value.roomIds[i]].outer, result.rooms[value.roomIds[j]].outer));
  }
}
function withChat(value: LayoutInput, mode: number): LayoutInput {
  return { ...value, chat: Object.fromEntries(value.roomIds.map((id, index) => [id, {
    visible: mode === 1 || (mode === 2 && index % 2 === 0), preferredWidthDip: index % 2 ? 220 : 280,
  }])) };
}

test('equal layouts cover 0..20 with wide, narrow, tall, fractional and DPI-derived canvases', () => {
  const canvases = [[1920, 1080], [960, 640], [340, 1600], [3000, 300], [853.333, 479.5],
    ...[1, 1.25, 1.5, 2].map(scale => [3840 / scale - 24, 2160 / scale - 100])];
  for (let count = 0; count <= 20; count++) for (const [width, height] of canvases) for (const chat of [0, 1, 2]) {
    const value = withChat(input(count, width, height), chat);
    const result = computeLayout(value);
    assertGeometry(value, result);
    assert.deepEqual(computeLayout(value), result);
    const rects = value.roomIds.map(id => result.rooms[id].outer);
    if (rects.length) {
      assert.ok(result.grid);
      assert.ok(result.grid.columns * result.grid.rows >= count);
      for (const rect of rects) {
        assert.ok(Math.abs(rect.width - rects[0].width) <= 1);
        assert.ok(Math.abs(rect.height - rects[0].height) <= 1);
      }
    } else assert.equal(result.spaceConstrained, false);
  }
});

test('5, 6 and 7 rooms are computed naturally during add/remove cycles', () => {
  for (const count of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) {
    const value = input(count);
    const result = computeLayout(value);
    assertGeometry(value, result);
    assert.equal(result.order.length, count);
  }
});

test('16:9 video utility avoids thin strips and considers chat without splitting content', () => {
  const plain = computeLayout(input(9));
  assert.ok(plain.grid!.columns >= 2 && plain.grid!.columns <= 4);
  const closed = input(6, 1600, 900);
  const open = withChat(closed, 1);
  const a = computeLayout(closed);
  const b = computeLayout(open);
  assertGeometry(open, b);
  assert.notDeepEqual(a.grid, b.grid, 'chat width should affect candidate scoring on this canvas');
  for (const id of open.roomIds) assert.equal(b.rooms[id].content.width, b.rooms[id].outer.width);
  const footer = computeLayout({ ...closed, chrome: { headerDip: 50, footerDip: 30 } });
  for (const id of closed.roomIds) {
    approximately(footer.rooms[id].content.y, footer.rooms[id].outer.y + 50);
    approximately(footer.rooms[id].content.height, footer.rooms[id].outer.height - 80);
  }
});

test('focus uses requested primary, equal secondary frames and a clearly larger main frame', () => {
  for (let count = 2; count <= 18; count++) for (const [width, height] of [[1920, 1080], [650, 1400], [3000, 240], [160, 160]]) {
    for (const share of [undefined, 0, 0.5, 0.7, 1]) {
      const value = withChat({ ...input(count, width, height, 'focus'), primaryRoomId: `room-${count - 1}`, primaryShare: share }, 2);
      const result = computeLayout(value);
      assertGeometry(value, result);
      const primary = result.rooms[value.primaryRoomId!].outer;
      const secondary = value.roomIds.filter(id => id !== value.primaryRoomId).map(id => result.rooms[id].outer);
      for (const rect of secondary) {
        approximately(rect.width, secondary[0].width);
        approximately(rect.height, secondary[0].height);
        assert.ok(primary.width * primary.height >= rect.width * rect.height * 1.49);
      }
    }
  }
});

test('missing or removed primary falls back to first stable room without reordering', () => {
  const value = { ...input(6, 1920, 1080, 'focus'), primaryRoomId: 'deleted-room' };
  const result = computeLayout(value);
  const first = result.rooms[value.roomIds[0]].outer;
  for (const id of value.roomIds.slice(1)) assert.ok(first.width * first.height > result.rooms[id].outer.width * result.rooms[id].outer.height);
  assert.deepEqual(result.order, value.roomIds);
});

test('one room fills canvas in both automatic modes; content remains inside when chrome consumes height', () => {
  for (const template of ['equal', 'focus'] as const) {
    const value = { ...input(1, 100, 20, template), chrome: { headerDip: 40, footerDip: 50 } };
    const result = computeLayout(value);
    assertGeometry(value, result);
    assert.deepEqual(result.rooms['room-0'].outer, { x: 0, y: 0, width: 100, height: 20 });
    assert.equal(result.rooms['room-0'].content.height, 0);
    assert.equal(result.spaceConstrained, true);
  }
});

test('tiny or zero canvases preserve every room and report constrained space', () => {
  for (const template of ['equal', 'focus', 'free'] as const) for (const [width, height] of [[0, 0], [0, 480], [640, 0], [1, 1], [18, 200]]) {
    const value = input(9, width, height, template);
    const result = computeLayout(value);
    assertGeometry(value, result, template !== 'free');
    assert.equal(result.spaceConstrained, true);
  }
  assert.equal(computeLayout(input(1, 1920, 1080)).spaceConstrained, false);
  assert.equal(computeLayout(withChat(input(1, 320, 240), 1)).spaceConstrained, true);
});

test('seeded property cases retain bounds, stable order, equal sizing and finite numbers', () => {
  let seed = 20261107;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 600; trial++) {
    const count = 2 + Math.floor(random() * 24);
    const value = withChat({ ...input(count, random() * 5000, random() * 3000, trial % 2 ? 'focus' : 'equal'),
      chrome: { gapDip: random() * 80, headerDip: random() * 70, footerDip: random() * 40 },
    }, trial % 3);
    const result = computeLayout(value);
    assertGeometry(value, result);
    if (value.template === 'equal') {
      const first = result.rooms[value.roomIds[0]].outer;
      for (const id of value.roomIds) approximately(result.rooms[id].outer.width, first.width);
    }
  }
});

test('normalization roundtrips in-bounds geometry without repeated rounding drift', () => {
  const canvas = { width: 1920, height: 1080 };
  const original = { x: 150.125, y: 210.25, width: 640.5, height: 360.75 };
  let restored = original;
  for (let i = 0; i < 100; i++) restored = recoverFreeRect(toNormalized(restored, canvas, 5), canvas);
  for (const key of ['x', 'y', 'width', 'height'] as const) approximately(restored[key], original[key]);
  const saved = toNormalized(original, canvas, 5);
  for (const scale of [1, 1.25, 1.5, 2]) {
    const next = recoverFreeRect(saved, { width: 3840 / scale, height: 2160 / scale });
    approximately(next.width / (3840 / scale), saved.width);
    approximately(next.height / (2160 / scale), saved.height);
  }
});

test('normalization clamps persistence coordinates and dimensions to the storage contract', () => {
  assert.deepEqual(toNormalized({ x: -20, y: -1, width: 4000, height: 2000 }, { width: 1920, height: 1080 }, 9),
    { x: 0, y: 0, width: 1, height: 1, z: 9 });
  const saved = toNormalized({ x: 2000, y: 1200, width: 640, height: 360 }, { width: 1920, height: 1080 }, 2);
  assert.equal(saved.x, 1); assert.equal(saved.y, 1);
  const rect = recoverFreeRect(saved, { width: 960, height: 640 });
  assert.ok(rect.x + 96 <= 960 && rect.y + 32 <= 640);
});

test('free recovery finds title handles after shrink or extreme off-canvas movement', () => {
  for (const x of [-1e300, -2, 0, 0.8, 1, 1e300]) for (const y of [-1e300, -1, 0.7, 1e300]) {
    const saved = { x, y, width: 1e300, height: 2, z: 0 };
    for (const canvas of [{ width: 960, height: 640 }, { width: 80, height: 20 }, { width: 0, height: 0 }]) {
      const rect = recoverFreeRect(saved, canvas);
      assertRect(rect);
      assert.ok(rect.x <= canvas.width - Math.min(96, rect.width) + EPS);
      assert.ok(rect.x + rect.width >= Math.min(96, rect.width) - EPS);
      assert.ok(rect.y >= 0 && rect.y + Math.min(32, rect.height) <= canvas.height + EPS);
      assert.ok(rect.width <= canvas.width && rect.height <= canvas.height);
    }
  }
});

test('free layouts preserve overlap/z and templates do not mutate saved geometry', () => {
  const rects: Record<string, NormalizedRect> = {
    'room-0': { x: 0.1, y: 0.1, width: 0.4, height: 0.4, z: 12 },
    'room-1': { x: 0.2, y: 0.2, width: 0.4, height: 0.4, z: 2 },
  };
  const value = { ...input(2, 1920, 1080, 'free'), freeRects: rects };
  const before = structuredClone(value);
  const free = computeLayout(value);
  assertGeometry(value, free, false);
  assert.ok(intersects(free.rooms['room-0'].outer, free.rooms['room-1'].outer));
  assert.equal(free.rooms['room-0'].z, 12); assert.equal(free.rooms['room-1'].z, 2);
  computeLayout({ ...value, template: 'equal' }); computeLayout({ ...value, template: 'focus' });
  assert.deepEqual(value, before);
  assert.deepEqual(computeLayout(value), free);
});

test('adding a free room first uses vacant space without scattering existing rooms', () => {
  const value = { ...input(2, 1920, 1080, 'free'), freeRects: {
    'room-0': { x: 0, y: 0, width: 0.3, height: 0.3, z: 1 },
  } };
  const existing = recoverFreeRect(value.freeRects['room-0'], value.canvas);
  const result = computeLayout(value);
  assert.deepEqual(result.rooms['room-0'].outer, existing);
  assert.ok(!intersects(existing, result.rooms['room-1'].outer));
});

test('free additions appear on top when no vacant space exists, including exhausted saved z', () => {
  for (const z of [100, Number.MAX_SAFE_INTEGER]) {
    const value = { ...input(3, 960, 640, 'free'), freeRects: {
      'room-0': { x: 0, y: 0, width: 1, height: 1, z },
    } };
    const result = computeLayout(value);
    assertGeometry(value, result, false);
    assert.ok(intersects(result.rooms['room-0'].outer, result.rooms['room-1'].outer));
    assert.ok(result.rooms['room-1'].z > result.rooms['room-0'].z);
    assert.ok(result.rooms['room-2'].z > result.rooms['room-1'].z);
  }
});

test('room IDs cannot change object prototypes', () => {
  const value = { ...input(0), roomIds: ['__proto__', 'constructor', 'toString'] };
  const result = computeLayout(value);
  assertGeometry(value, result);
  assert.ok(Object.hasOwn(result.rooms, '__proto__'));
});

test('rejects nonfinite data, duplicate IDs, invalid sizes and invalid z', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => computeLayout({ ...input(2), canvas: { width: bad, height: 100 } }), RangeError);
    assert.throws(() => computeLayout({ ...input(2), chrome: { gapDip: bad } }), RangeError);
    assert.throws(() => computeLayout({ ...input(2), primaryShare: bad }), RangeError);
    assert.throws(() => recoverFreeRect({ x: bad, y: 0, width: 1, height: 1, z: 0 }, { width: 100, height: 100 }), RangeError);
    assert.throws(() => toNormalized({ x: 0, y: 0, width: bad, height: 1 }, { width: 100, height: 100 }, 0), RangeError);
  }
  assert.throws(() => computeLayout({ ...input(2), roomIds: ['same', 'same'] }), RangeError);
  assert.throws(() => computeLayout({ ...input(1), canvas: { width: -1, height: 10 } }), RangeError);
  assert.throws(() => computeLayout({ ...input(1), chat: { 'room-0': { visible: true, preferredWidthDip: -1 } } }), RangeError);
  for (const z of [-1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => toNormalized({ x: 0, y: 0, width: 1, height: 1 }, { width: 100, height: 100 }, z), RangeError);
  }
  assert.throws(() => toNormalized({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 100 }, 0), RangeError);
  assert.throws(() => recoverFreeRect({ x: 0, y: 0, width: 0, height: 1, z: 0 }, { width: 100, height: 100 }), RangeError);
});
