import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeLayout, toNormalized } from '../../../src/domain/layout/index.ts';
import type { LayoutInput, LayoutResult, RectDip } from '../../../src/shared/contracts.ts';

const EPS = 1e-7;
// Measured content canvas supplied by the root on its 4K/175% display.
// This is a DIP regression input, not an actual system-DPI transition test.
const CANVAS = { width: 2123, height: 964 };
const CHROME = { headerDip: 36, footerDip: 8, gapDip: 8, minWidthDip: 220, minHeightDip: 120 };
function value(count: number, primary = 0, mode: 'all' | 'mixed' | 'closed' = 'all', primaryShare?: number): LayoutInput {
  const roomIds = Array.from({ length: count }, (_, index) => `room-${index}`);
  return { canvas: { ...CANVAS }, roomIds, template: 'focus', primaryRoomId: roomIds[primary], primaryShare,
    chrome: { ...CHROME }, chat: Object.fromEntries(roomIds.map((id, index) => [id, {
      visible: mode === 'all' || (mode === 'mixed' && index % 3 !== 1), preferredWidthDip: [200, 240, 300, 340][index % 4],
    }])) };
}
function chatFits(input: LayoutInput, result: LayoutResult, id: string): boolean {
  const content = result.rooms[id].content;
  return content.width >= input.chat[id].preferredWidthDip + 128 - EPS && content.height >= 240 - EPS;
}
function fitsAllRequestedChats(input: LayoutInput, result: LayoutResult): void {
  for (const id of input.roomIds) if (input.chat[id].visible) {
    assert.ok(chatFits(input, result, id), `${id} chat must fit ${input.chat[id].preferredWidthDip}+128 width and 240 height`);
    const content = result.rooms[id].content;
    const videoWidth = Math.min(content.width - input.chat[id].preferredWidthDip, content.height * 16 / 9);
    assert.ok(videoWidth >= 128 - EPS && videoWidth / (16 / 9) >= 72 - EPS);
  }
}
function checkGeometry(input: LayoutInput, result: LayoutResult): void {
  assert.deepEqual(result.order, input.roomIds);
  assert.equal(Object.keys(result.rooms).length, input.roomIds.length);
  const main = result.rooms[input.primaryRoomId!].outer;
  const secondary = input.roomIds.filter(id => id !== input.primaryRoomId).map(id => result.rooms[id].outer);
  for (const id of input.roomIds) {
    const { outer, content, z } = result.rooms[id];
    assert.ok(Object.values(outer).every(Number.isFinite) && Object.values(content).every(Number.isFinite));
    assert.ok(outer.x >= -EPS && outer.y >= -EPS && outer.width >= 0 && outer.height >= 0);
    assert.ok(outer.x + outer.width <= input.canvas.width + EPS && outer.y + outer.height <= input.canvas.height + EPS);
    assert.ok(content.x >= outer.x - EPS && content.y >= outer.y - EPS);
    assert.ok(content.x + content.width <= outer.x + outer.width + EPS && content.y + content.height <= outer.y + outer.height + EPS);
    assert.ok(Number.isSafeInteger(z) && z >= 0);
  }
  for (const rect of secondary) {
    assert.ok(Math.abs(rect.width - secondary[0].width) < EPS && Math.abs(rect.height - secondary[0].height) < EPS);
    assert.ok(main.width * main.height + EPS >= rect.width * rect.height * 1.5);
  }
  const rects = input.roomIds.map(id => result.rooms[id].outer);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const overlap = a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS
      && a.y < b.y + b.height - EPS && b.y < a.y + a.height - EPS;
    assert.equal(overlap, false);
  }
}

test('4K/175% measured canvas keeps native chat budgets for nine rooms using a cross-grid main block', () => {
  for (const width of [240, 280, 300, 340]) for (const primary of [0, 4, 8]) {
    const input = value(9, primary);
    input.chat = Object.fromEntries(input.roomIds.map(id => [id, { visible: true, preferredWidthDip: width }]));
    const result = computeLayout(input);
    checkGeometry(input, result);
    fitsAllRequestedChats(input, result);
    assert.equal(result.spaceConstrained, false);
    const main = result.rooms[input.primaryRoomId!].outer;
    assert.ok(main.width < CANVAS.width && main.height < CANVAS.height, 'a spanning main block should replace the inadequate full-axis strip');
    for (const id of input.roomIds) {
      assert.equal(result.rooms[id].content.width, result.rooms[id].outer.width, 'chat stays in the same native page');
    }
  }
});

test('2..9 rooms, every primary and mixed chat widths satisfy the feasible native-chat budgets', () => {
  for (let count = 2; count <= 9; count++) for (let primary = 0; primary < count; primary++) {
    for (const mode of ['all', 'mixed'] as const) for (const share of [undefined, 0.05, 0.95]) {
      const input = value(count, primary, mode, share);
      const before = structuredClone(input);
      const result = computeLayout(input);
      checkGeometry(input, result);
      fitsAllRequestedChats(input, result);
      assert.equal(result.spaceConstrained, false);
      assert.deepEqual(computeLayout(input), result);
      assert.deepEqual(input, before);
    }
  }
});

test('spanning candidates remain natural for 2..20 rooms and mark insufficient space without hiding rooms', () => {
  for (let count = 2; count <= 20; count++) for (const canvas of [CANVAS, { width: 960, height: 640 }, { width: 700, height: 1600 }]) {
    const input = { ...value(count, count - 1), canvas };
    const result = computeLayout(input);
    checkGeometry(input, result);
    if (input.roomIds.some(id => !chatFits(input, result, id))) assert.equal(result.spaceConstrained, true);
  }
});

test('requested chat capacity outranks an explicit oversized main-area preference', () => {
  const input = value(9, 4, 'all', 0.95);
  input.chat = Object.fromEntries(input.roomIds.map(id => [id, { visible: true, preferredWidthDip: 340 }]));
  const result = computeLayout(input);
  fitsAllRequestedChats(input, result);
  checkGeometry(input, result);
  const main = result.rooms[input.primaryRoomId!].outer;
  assert.ok(main.width * main.height / (CANVAS.width * CANVAS.height) < 0.6);
});

test('an impossible chat width does not sacrifice eight other feasible native chats', () => {
  const input = value(9, 0);
  input.chat = Object.fromEntries(input.roomIds.map((id, index) => [id, { visible: true, preferredWidthDip: index === 0 ? 3000 : 340 }]));
  const result = computeLayout(input);
  checkGeometry(input, result);
  assert.equal(chatFits(input, result, input.roomIds[0]), false);
  for (const id of input.roomIds.slice(1)) assert.equal(chatFits(input, result, id), true);
  assert.equal(result.spaceConstrained, true);
});

test('closed chat keeps the existing main-strip family across 2..20 rooms and window shapes', () => {
  for (let count = 2; count <= 20; count++) for (const canvas of [CANVAS, { width: 700, height: 1600 }, { width: 3000, height: 300 }]) {
    const input = { ...value(count, count - 1, 'closed'), canvas };
    const result = computeLayout(input);
    checkGeometry(input, result);
    const main = result.rooms[input.primaryRoomId!].outer;
    assert.ok(Math.abs(main.width - canvas.width) < EPS || Math.abs(main.height - canvas.height) < EPS);
  }
});

test('cross-grid layout can seed free editing without changing any room geometry or stable order', () => {
  const input = value(9, 5);
  const focus = computeLayout(input);
  const freeRects = Object.fromEntries(input.roomIds.map(id => [id, toNormalized(focus.rooms[id].outer, input.canvas, focus.rooms[id].z)]));
  const free = computeLayout({ ...input, template: 'free', freeRects });
  assert.deepEqual(free.order, focus.order);
  for (const id of input.roomIds) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      assert.ok(Math.abs(free.rooms[id].outer[key] - focus.rooms[id].outer[key]) < EPS);
    }
    assert.equal(free.rooms[id].z, focus.rooms[id].z);
  }
});

test('2..20 focus layouts stay total and finite on zero/underflowed canvases', () => {
  for (let count = 2; count <= 20; count++) for (const canvas of [
    { width: 0, height: 0 }, { width: 0, height: 964 }, { width: 2123, height: 0 },
    { width: 1e-300, height: 1e-300 },
  ]) {
    const input = { ...value(count, count - 1), canvas };
    const result = computeLayout(input);
    checkGeometry(input, result);
    assert.equal(result.spaceConstrained, true);
  }
});
