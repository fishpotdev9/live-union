import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppCommand, AppState, CommandResult, LiveUnionBridge } from '../../../src/shared/app-contracts.ts';
import { commandQueue, connectState } from '../../../src/renderer/components/bridge.ts';
import { geometryGesture } from '../../../src/renderer/workspace/geometry-gesture.ts';

test('geometry coalesces screen positions into absolute deltas and flushes before ending', () => {
  const commands: AppCommand[] = [];
  const frames = new Map<number, () => void>();
  let frameId = 0;
  const gesture = geometryGesture({ roomId: 'room', gestureId: 'gesture', kind: 'move', x: 100, y: 200,
    send: command => commands.push(command),
    frames: { request(callback) { frames.set(++frameId, callback); return frameId; }, cancel(id) { frames.delete(id); } },
  });
  gesture.move(110, 205); gesture.move(125, 215);
  assert.equal(frames.size, 1);
  const [id, callback] = [...frames.entries()][0]; frames.delete(id); callback();
  gesture.move(130, 220); gesture.end(); gesture.end(); gesture.move(800, 800);
  assert.deepEqual(commands, [
    { type: 'geometryBegin', roomId: 'room', gestureId: 'gesture', kind: 'move' },
    { type: 'geometryDelta', roomId: 'room', gestureId: 'gesture', dx: 25, dy: 15 },
    { type: 'geometryDelta', roomId: 'room', gestureId: 'gesture', dx: 30, dy: 20 },
    { type: 'geometryEnd', roomId: 'room', gestureId: 'gesture' },
  ]);
  assert.equal(frames.size, 0);
  assert.ok(commands.every(command => !['setAudio', 'soloAudio', 'muteAll', 'reloadRoom'].includes(command.type)));
});

test('cancel without movement ends exactly once and ignores invalid coordinates', () => {
  const commands: AppCommand[] = [];
  const gesture = geometryGesture({ roomId: 'room', gestureId: 'gesture', kind: 'resize', x: 1, y: 2,
    send: command => commands.push(command), frames: { request() { throw new Error('Unexpected frame'); }, cancel() {} },
  });
  gesture.move(Number.NaN, 100); gesture.move(100, Number.POSITIVE_INFINITY);
  gesture.end(); gesture.end();
  assert.deepEqual(commands.map(command => command.type), ['geometryBegin', 'geometryEnd']);
});

test('asynchronous command queue preserves ordering and continues after IPC rejection', async () => {
  const commands: AppCommand[] = [];
  let release: ((value: CommandResult) => void) | undefined;
  const messages: string[] = [];
  const bridge: LiveUnionBridge = {
    command(command) {
      commands.push(command);
      if (commands.length === 1) return new Promise(resolve => { release = resolve; });
      if (commands.length === 2) return Promise.reject(new Error('Sensitive implementation details'));
      return Promise.resolve({ ok: true, revision: 2 });
    },
    onState() { return () => {}; },
  };
  const send = commandQueue(bridge, message => messages.push(message));
  const begin = send({ type: 'geometryBegin', roomId: 'room', gestureId: 'gesture', kind: 'move' });
  const delta = send({ type: 'geometryDelta', roomId: 'room', gestureId: 'gesture', dx: 1, dy: 2 });
  const end = send({ type: 'geometryEnd', roomId: 'room', gestureId: 'gesture' });
  await Promise.resolve();
  assert.equal(commands.length, 1);
  assert.ok(release); release({ ok: true, revision: 1 });
  await Promise.all([begin, delta, end]);
  assert.deepEqual(commands.map(command => command.type), ['geometryBegin', 'geometryDelta', 'geometryEnd']);
  assert.equal(messages.length, 1);
  assert.ok(!messages[0].includes('Sensitive'));
});

test('pending network add cannot block muteAll or the ordered geometry stream', async () => {
  const invoked: string[] = [];
  let releaseAdd: ((result: CommandResult) => void) | undefined;
  let releaseBegin: ((result: CommandResult) => void) | undefined;
  let addSettled = false;
  const bridge: LiveUnionBridge = {
    command(command) {
      invoked.push(command.type);
      if (command.type === 'addRoom') return new Promise(resolve => { releaseAdd = resolve; });
      if (command.type === 'geometryBegin') return new Promise(resolve => { releaseBegin = resolve; });
      return Promise.resolve({ ok: true, revision: 2 });
    },
    onState() { return () => {}; },
  };
  const messages: string[] = [];
  const send = commandQueue(bridge, message => messages.push(message));
  const add = send({ type: 'addRoom', url: 'https://www.huya.com/example' }).then(() => { addSettled = true; });
  const begin = send({ type: 'geometryBegin', roomId: 'room', gestureId: 'drag', kind: 'move' });
  const delta = send({ type: 'geometryDelta', roomId: 'room', gestureId: 'drag', dx: 20, dy: 30 });
  const end = send({ type: 'geometryEnd', roomId: 'room', gestureId: 'drag' });
  const mute = send({ type: 'muteAll' });
  assert.deepEqual(invoked, ['addRoom', 'muteAll'], 'independent controls invoke immediately');
  await mute;
  assert.deepEqual(invoked, ['addRoom', 'muteAll', 'geometryBegin']);
  assert.equal(addSettled, false);
  assert.ok(releaseBegin); releaseBegin({ ok: true, revision: 1 });
  await Promise.all([begin, delta, end]);
  assert.deepEqual(invoked, ['addRoom', 'muteAll', 'geometryBegin', 'geometryDelta', 'geometryEnd']);
  assert.equal(addSettled, false, 'all geometry completed while add is still pending');
  assert.deepEqual(messages, []);
  assert.ok(releaseAdd); releaseAdd({ ok: true, revision: 3 });
  await add;
});

test('direct commands share the same sanitized IPC failure handling as geometry commands', async () => {
  const messages: string[] = [];
  const bridge: LiveUnionBridge = {
    command(command) {
      if (command.type === 'muteAll') throw new Error('Sensitive native failure');
      if (command.type === 'addRoom') return Promise.reject(new Error('Sensitive network failure'));
      return Promise.resolve({ ok: false, error: '可理解的操作反馈' });
    },
    onState() { return () => {}; },
  };
  const send = commandQueue(bridge, message => messages.push(message));
  assert.equal(await send({ type: 'muteAll' }), undefined);
  assert.equal(await send({ type: 'addRoom', url: 'https://www.huya.com/example' }), undefined);
  assert.deepEqual(await send({ type: 'setChat', roomId: 'room', visible: false }), { ok: false, error: '可理解的操作反馈' });
  assert.deepEqual(messages, ['操作未完成，请重试。', '操作未完成，请重试。', '可理解的操作反馈']);
  assert.ok(messages.every(message => !message.includes('Sensitive')));
});

test('state subscription precedes request, ignores older revisions, and disposes', async () => {
  const events: string[] = [];
  let listener: ((state: AppState) => void) | undefined;
  const rendered: number[] = [];
  const bridge: LiveUnionBridge = {
    async command(command) { events.push(command.type); return { ok: true, revision: 0 }; },
    onState(next) { events.push('subscribe'); listener = next; return () => events.push('unsubscribe'); },
  };
  const connection = connectState(bridge, next => rendered.push(next.revision), () => {});
  await Promise.resolve();
  assert.deepEqual(events, ['subscribe', 'getState']);
  // Only revisions are consumed by this transport; the presentation owns shape-specific rendering.
  listener!({ revision: 3 } as AppState); listener!({ revision: 2 } as AppState);
  listener!({ revision: 4 } as AppState); connection.dispose();
  listener!({ revision: 5 } as AppState);
  assert.deepEqual(rendered, [3, 4]);
  assert.equal(events.at(-1), 'unsubscribe');
});
