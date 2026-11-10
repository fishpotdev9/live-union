import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { WorkspaceModel } from '../../../src/domain/workspace/index.ts';
import { geometryGesture } from '../../../src/renderer/workspace/geometry-gesture.ts';
import { commandQueue } from '../../../src/renderer/components/bridge.ts';
import type { AppCommand, CommandResult } from '../../../src/shared/app-contracts.ts';
import type { WorkspaceSnapshot } from '../../../src/shared/contracts.ts';

const source = await readFile(new URL('../../../src/renderer/workspace/room.ts', import.meta.url), 'utf8');
const start = source.indexOf('let active:');
assert.ok(start >= 0);
// Execute the real handler block. Rendering/CSS/native hit-testing are outside this
// boundary; no handler or command policy is reimplemented in the fake event surface.
const { code } = await transform(source.slice(start).replace(/^const connection = connectState.*$/m, ''), { loader: 'ts', target: 'es2022' });
const drain = async () => { for (let step = 0; step < 40; step++) await Promise.resolve(); };
function sample(): WorkspaceSnapshot {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const rects = [[0, 0, 1413, 640], [1421, 0, 702, 316], [1421, 324, 702, 316], [0, 648, 702, 316], [710, 648, 702, 316]];
  return { schemaVersion: 1, id: 'workspace', name: 'Offline input', stableOrder: ids,
    rooms: ids.map((id, index) => ({ id, platform: 'huya', platformRoomId: String(100 + index),
      canonicalUrl: `https://www.huya.com/${100 + index}`, chat: { visible: false, preferredWidthDip: 280 }, audio: { allowed: false } })),
    layout: { base: 'focus', editing: 'free', primaryRoomId: 'a', equal: { variant: 'auto', order: [...ids] }, focus: { variant: 'auto', order: [...ids] },
      free: { from: 'focus', rects: Object.fromEntries(ids.map((id, index) => [id, {
        x: rects[index][0] / 2123, y: rects[index][1] / 964, width: rects[index][2] / 2123, height: rects[index][3] / 964, z: index,
      }])) } } };
}
type FakeEvent = { target?: Surface; pointerId?: number; detail?: number; [key: string]: unknown };
async function harness(t: TestContext, options: { delayDelta?: boolean; captureFails?: boolean } = {}) {
  const model = new WorkspaceModel(sample(), { width: 2123, height: 964 });
  const commands: AppCommand[] = [], frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  let now = 0, frame = 0, timer = 0, captureCalls = 0, focusCalls = 0, selection = false;
  let releaseDelta!: (result: CommandResult) => void;
  const delta = new Promise<CommandResult>(resolve => { releaseDelta = resolve; });
  class ElementSurface extends Surface {
    dataset: Record<string, string> = {};
    parent?: ElementSurface;
    captures = new Set<number>();
    classList = { add() {}, remove() {} };
    disabled = false;
    readonly tag: string;
    constructor(tag: string) { super(); this.tag = tag; }
    closest(selectors: string): ElementSurface | null {
      for (let node: ElementSurface | undefined = this; node; node = node.parent) {
        if (selectors.split(',').some(part => part === node!.tag || (part === '[data-no-drag]' && Object.hasOwn(node!.dataset, 'noDrag')))) return node;
      }
      return null;
    }
    focus(options: { preventScroll: boolean }) { assert.equal(options.preventScroll, true); focusCalls++; }
    setPointerCapture(id: number) { captureCalls++; if (options.captureFails) throw new Error('Injected capture failure'); this.captures.add(id); }
    hasPointerCapture(id: number) { return this.captures.has(id); }
    releasePointerCapture(id: number) { this.captures.delete(id); this.emit('lostpointercapture', { pointerId: id }); }
  }
  const header = new ElementSurface('header'), resize = new ElementSurface('button'), shell = new ElementSurface('section');
  const identity = new ElementSurface('div'), label = new ElementSurface('span'), control = new ElementSurface('button'), outside = new ElementSurface('div');
  identity.parent = header; label.parent = identity; control.parent = header; label.dataset.noDrag = '';
  const window = Object.assign(new Surface(), { getSelection: () => ({ toString: () => selection ? 'fixture selection' : '' }) });
  const send = commandQueue({
    command(command) {
      commands.push(structuredClone(command)); model.apply(command);
      return options.delayDelta && command.type === 'geometryDelta' ? delta : Promise.resolve({ ok: true, revision: commands.length });
    }, onState() { return () => {}; },
  }, () => { throw new Error('Unexpected transport failure'); });
  control.addEventListener('click', () => { void send({ type: 'setChat', roomId: 'a', visible: true }); });
  vm.runInNewContext(code, { window, header, resize, shell, alive: true, roomId: 'a', state: { workspace: model.snapshot }, send,
    geometryGesture, Element: ElementSurface, HTMLElement: ElementSurface, crypto: { randomUUID }, performance: { now: () => now },
    requestAnimationFrame: (callback: () => void) => { frames.set(++frame, callback); return frame; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void, delay: number) => { timers.set(++timer, { at: now + delay, callback }); return timer; },
    clearTimeout: (id: number) => timers.delete(id), connection: { dispose() {} },
  });
  const event = (target: ElementSurface, pointerId = 7, dx = 0, dy = 0): FakeEvent => ({ target, pointerId,
    button: 0, isPrimary: true, screenX: 700 + dx, screenY: 175 + dy, preventDefault() {} });
  const down = (target = header, pointerId = 7) => {
    const value = event(target, pointerId); window.emit('pointerdown', value);
    (target === resize ? resize : header).emit('pointerdown', value);
  };
  const click = (detail = 1, target = header, pointerId: number | null = 7) => {
    const value = { target, detail, ...(pointerId === null ? {} : { pointerId }) };
    if (target === control) control.emit('click', value);
    header.emit('click', value);
  };
  const move = (dx: number, dy: number, pointerId = 7) => {
    window.emit('pointermove', event(header, pointerId, dx, dy));
    for (const [id, callback] of frames) { frames.delete(id); callback(); }
  };
  const up = (dx = 0, dy = 0, target = header, pointerId = 7) => window.emit('pointerup', event(target, pointerId, dx, dy));
  const advance = (ms: number, runTimers = true) => {
    now += ms;
    if (runTimers) for (const [id, value] of timers) if (value.at <= now) { timers.delete(id); value.callback(); }
  };
  t.after(async () => { releaseDelta({ ok: true, revision: 1 }); window.emit('pagehide'); await drain(); assert.equal(timers.size, 0); assert.equal(frames.size, 0); });
  return { model, commands, window, header, resize, identity, label, control, outside, down, click, move, up, advance, timers,
    release: () => releaseDelta({ ok: true, revision: 1 }), select: (value: boolean) => { selection = value; },
    captures: () => captureCalls, focuses: () => focusCalls };
}
class Surface {
  private readonly events = new Map<string, Array<(event: FakeEvent) => void>>();
  addEventListener(name: string, callback: (event: FakeEvent) => void) { this.events.set(name, [...(this.events.get(name) ?? []), callback]); }
  emit(name: string, event: FakeEvent = {}) { for (const callback of this.events.get(name) ?? []) callback(event); }
}

test('a post-pointerup click cannot overtake queued End behind a delayed Delta acknowledgement', async t => {
  const h = await harness(t, { delayDelta: true });
  h.down(); await drain(); h.move(215, 70); await drain();
  assert.equal(h.model.geometry.rooms.a.outer.x, 215); assert.equal(h.model.snapshot.layout.free.rects.a.x, 0);
  h.up(215, 70); h.click();
  assert.deepEqual(h.commands.map(command => command.type), ['selectRoom', 'raiseRoom', 'geometryBegin', 'geometryDelta']);
  h.release(); await drain();
  assert.equal(h.commands.at(-1)?.type, 'geometryEnd');
  assert.equal(h.model.geometry.rooms.a.outer.x, 215); assert.equal(h.model.geometry.rooms.a.outer.y, 70);
  assert.equal(h.model.geometry.rooms.a.z, 5);
});

test('normal blank-title dragging captures/focuses locally and commits once while preserving text-only guards', async t => {
  assert.ok(!source.includes('identity.dataset.noDrag'));
  assert.ok(source.includes('platform.dataset.noDrag') && source.includes('label.dataset.noDrag'));
  const h = await harness(t); h.down(h.identity); await drain(); h.move(215, 70); h.up(215, 70); h.click(); await drain();
  assert.equal(h.captures(), 1); assert.equal(h.focuses(), 1);
  assert.equal(h.model.geometry.rooms.a.outer.x, 215); assert.equal(h.model.geometry.rooms.a.outer.y, 70);
  assert.equal(h.commands.filter(command => command.type === 'geometryEnd').length, 1);
  assert.equal(h.commands.filter(command => command.type === 'raiseRoom').length, 1);
  assert.ok(h.model.snapshot.rooms.every(room => !room.audio.allowed));
});

test('an accepted no-movement click selects and raises only once', async t => {
  const h = await harness(t); h.down(); h.up(); h.click(); await drain();
  assert.deepEqual(h.commands.map(command => command.type), ['selectRoom', 'raiseRoom', 'geometryBegin', 'geometryEnd']);
  assert.equal(h.model.geometry.rooms.a.outer.x, 0); assert.equal(h.model.geometry.rooms.a.z, 5);
});

test('detail-zero keyboard/UIA clicks remain available without a pointer gesture and consume stale markers', async t => {
  const h = await harness(t); h.click(0); await drain();
  assert.deepEqual(h.commands.map(command => command.type), ['selectRoom', 'raiseRoom']);
  h.down(); h.up(); await drain(); const before = h.commands.length;
  h.click(0); h.click(1); await drain();
  assert.deepEqual(h.commands.slice(before).map(command => command.type), ['selectRoom', 'raiseRoom', 'selectRoom', 'raiseRoom']);
  assert.equal(h.timers.size, 0);
});

test('an outside release expires its orphan marker, including when the expiry timer is throttled', async t => {
  for (const runTimers of [true, false]) {
    const h = await harness(t); h.down(); h.up(0, 0, h.outside); await drain();
    assert.equal(h.timers.size, 1); h.advance(501, runTimers); const before = h.commands.length;
    h.click(); await drain();
    assert.deepEqual(h.commands.slice(before).map(command => command.type), ['selectRoom', 'raiseRoom']);
    assert.equal(h.timers.size, 0);
  }
});

test('a later guarded pointerdown clears suppression and text/control default behavior is untouched', async t => {
  const h = await harness(t); h.down(); h.up(); await drain();
  const before = h.commands.length; h.down(h.label); h.click(1, h.label); await drain();
  assert.deepEqual(h.commands.slice(before).map(command => command.type), ['selectRoom', 'raiseRoom']);
  const controls = h.commands.length; h.down(h.control); h.click(1, h.control); await drain();
  assert.deepEqual(h.commands.slice(controls).map(command => command.type), ['setChat']);
  assert.equal(h.captures(), 1); assert.equal(h.focuses(), 1);
  h.select(true); const selected = h.commands.length; h.down(); h.up(); await drain();
  assert.equal(h.commands.length, selected); assert.equal(h.captures(), 1);
});

test('cancel/lost-capture/blur and capture failure end once and cannot retain suppression indefinitely', async t => {
  for (const reason of ['pointercancel', 'lostpointercapture', 'blur', 'capture-failed']) {
    const h = await harness(t, { captureFails: reason === 'capture-failed' }); h.down();
    if (reason === 'lostpointercapture') h.header.emit(reason, { pointerId: 7 });
    else if (reason !== 'capture-failed') h.window.emit(reason, { pointerId: 7 });
    h.up(); h.click(); await drain();
    assert.equal(h.commands.filter(command => command.type === 'geometryEnd').length, 1);
    assert.equal(h.commands.filter(command => command.type === 'raiseRoom').length, 1);
    h.advance(501); h.click(0); await drain();
    assert.equal(h.commands.filter(command => command.type === 'raiseRoom').length, 2);
    assert.equal(h.timers.size, 0);
  }
});

test('legacy positive-detail mouse clicks are suppressed once while another pointer is independent', async t => {
  const legacy = await harness(t); legacy.down(); legacy.up(); legacy.click(1, legacy.header, null); await drain();
  assert.equal(legacy.commands.filter(command => command.type === 'raiseRoom').length, 1);
  const other = await harness(t); other.down(); other.up(); other.click(1, other.header, 9); await drain();
  assert.equal(other.commands.filter(command => command.type === 'raiseRoom').length, 2);
});
