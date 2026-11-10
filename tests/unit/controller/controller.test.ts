import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Controller } from '../../../src/main/bootstrap/controller.ts';
import type { AudioIntent, AppCommand, AppState, PlatformPresentation } from '../../../src/shared/app-contracts.ts';
import type { RoomConfig, RoomGeometry, WorkspaceLoadResult, WorkspaceSnapshot } from '../../../src/shared/contracts.ts';
import type { RoomRuntimeManager, RuntimeIdentity } from '../../../src/main/runtime-contracts.ts';

type Options = ConstructorParameters<typeof Controller>[0];
type Address = Awaited<ReturnType<Options['resolveRoom']>>;
function historyFake():NonNullable<Options['history']>{
  const entry={id:'77777777-0000-4000-8000-000000000001',platform:'bilibili' as const,platformRoomId:'7734200',canonicalUrl:'https://live.bilibili.com/7734200',lastAddedAt:1};
  return{state:{status:'ready',entries:[entry]},async initialize(){},async record(){},entry:id=>id===entry.id?entry:undefined,async remove(){},async clear(){},refreshMetadata(){},async resolveIdentity(address){return address.platform==='bilibili'&&address.platformRoomId==='6'?entry:address;},async shutdown(){}};
}
const FIRST = '10000000-0000-4000-8000-000000000000';
const SECOND = '20000000-0000-4000-8000-000000000000';
const COPY = '30000000-0000-4000-8000-000000000000';
const address: Address = { platform: 'huya', platformRoomId: '999', canonicalUrl: 'https://www.huya.com/999', live: 'unknown' };
const clone = <T>(value: T): T => structuredClone(value);
function sample(workspaceId = FIRST, count = 3, firstRoom = 0): WorkspaceSnapshot {
  const rooms: RoomConfig[] = Array.from({ length: count }, (_, offset) => {
    const index = firstRoom + offset;
    return { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, platform: 'huya',
      platformRoomId: String(index + 100), canonicalUrl: `https://www.huya.com/${index + 100}`,
      chat: { visible: false, preferredWidthDip: 280 }, audio: { allowed: index % 2 === 0 } };
  });
  const order = rooms.map(room => room.id);
  return { schemaVersion: 1, id: workspaceId, name: `Workspace ${workspaceId[0]}`, rooms, stableOrder: [...order],
    layout: { base: 'equal', editing: 'auto', primaryRoomId: order[0],
      equal: { variant: 'auto', order: [...order] }, focus: { variant: 'auto', order: [...order] },
      free: { from: 'equal', rects: {} } } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean, message: string): Promise<void> {
  for (let step = 0; step < 40 && !predicate(); step++) await Promise.resolve();
  assert.ok(predicate(), message);
}

/** Boundary fake only: records controller calls; it is not an Electron/audio-policy test. */
class Runtime implements RoomRuntimeManager {
  readonly failIds = new Set<string>();
  readonly created: RoomConfig[] = [];
  readonly closed: string[] = [];
  readonly reloads: string[] = [];
  readonly audioCalls: AudioIntent[] = [];
  readonly bounds: Array<{ rooms: Record<string, RoomGeometry>; revision: number }> = [];
  readonly identities = new Map<string, RuntimeIdentity>();
  private allowed = new Map<string, boolean>();
  disposals = 0;
  async createRoom(room: RoomConfig): Promise<RuntimeIdentity> {
    assert.equal(this.disposals, 0, 'controller must not create after disposal');
    if(this.failIds.has(room.id))throw new Error('Sensitive creation failure');
    this.created.push(clone(room));
    const identity = { roomId: room.id, generation: 1, webContentsId: this.created.length };
    this.identities.set(room.id, identity); this.allowed.set(room.id, room.audio.allowed);
    return identity;
  }
  closeRoom(roomId: string): void { this.closed.push(roomId); this.identities.delete(roomId); this.allowed.delete(roomId); }
  reloadRoom(roomId: string): void { this.reloads.push(roomId); }
  applyBoundsBatch(rooms: Readonly<Record<string, RoomGeometry>>, revision: number): void { this.bounds.push({ rooms: clone(rooms), revision }); }
  setZOrder(): void {}
  applyAudio(intent: AudioIntent): ReadonlyMap<string, boolean> {
    this.audioCalls.push(clone(intent));
    if (intent.kind === 'muteAll' || intent.kind === 'solo') for (const roomId of this.allowed.keys()) this.allowed.set(roomId, false);
    if (intent.kind === 'set' && this.allowed.has(intent.roomId)) this.allowed.set(intent.roomId, intent.allowed);
    if (intent.kind === 'solo' && this.allowed.has(intent.roomId)) this.allowed.set(intent.roomId, true);
    return this.getAudioAllowed();
  }
  getAudioAllowed(): ReadonlyMap<string, boolean> { return new Map(this.allowed); }
  getRuntimeIdentity(roomId: string): RuntimeIdentity | undefined { return this.identities.get(roomId); }
  getContents(): undefined { return undefined; }
  permitLoginPopup(): void {}
  openLoginWindow(): void {}
  dispose(): void { this.disposals++; this.identities.clear(); this.allowed.clear(); }
}
class Catalog {
  readonly saveAttempts: WorkspaceSnapshot[] = [];
  readonly saveCommits: WorkspaceSnapshot[] = [];
  readonly saveAsInputs: WorkspaceSnapshot[] = [];
  readonly opened: string[] = [];
  readonly stored = new Map<string, WorkspaceSnapshot>();
  saveHook?: (snapshot: WorkspaceSnapshot) => Promise<void>;
  saveAsHook?: (snapshot: WorkspaceSnapshot, name: string) => Promise<WorkspaceSnapshot>;
  openHook?: (id: string) => Promise<WorkspaceLoadResult>;
  constructor(snapshots: WorkspaceSnapshot[]) { for (const snapshot of snapshots) this.stored.set(snapshot.id, clone(snapshot)); }
  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const captured = clone(snapshot); this.saveAttempts.push(captured);
    await this.saveHook?.(clone(captured));
    this.saveCommits.push(clone(captured)); this.stored.set(captured.id, captured);
  }
  async saveAs(snapshot: WorkspaceSnapshot, name: string): Promise<WorkspaceSnapshot> {
    const captured = clone(snapshot); this.saveAsInputs.push(captured);
    const result = this.saveAsHook ? await this.saveAsHook(clone(captured), name) : { ...captured, id: COPY, name };
    this.stored.set(result.id, clone(result));
    return clone(result);
  }
  async open(id: string): Promise<WorkspaceLoadResult> {
    this.opened.push(id);
    if (this.openHook) return this.openHook(id);
    const snapshot = this.stored.get(id);
    if (!snapshot) throw new Error('Workspace unavailable');
    return { snapshot: clone(snapshot), source: 'primary', warnings: [] };
  }
  async list() { return [...this.stored.values()].map(({ id, name }) => ({ id, name })); }
}
async function harness(t: TestContext, initial = sample(), failureIds:string[] = [],history?:Options['history'],nickname?:Options['nickname']) {
  const target = sample(SECOND, 2, 50);
  const runtime = new Runtime();
  for(const id of failureIds)runtime.failIds.add(id);
  const catalog = new Catalog([initial, target]);
  const published: AppState[] = [];
  const cleanup: Array<() => void> = [];
  const operations: Promise<unknown>[] = [];
  let resolve: Options['resolveRoom'] = async () => address;
  const adapter = (id: PlatformPresentation['id']): PlatformPresentation => ({ id, version: 'offline-test', build() { throw new Error('No real page is available in this boundary test'); } });
  const controller = new Controller({
    window: { isFullScreen: () => false, setFullScreen() {} } as unknown as Options['window'],
    runtime, catalog: catalog as unknown as Options['catalog'], snapshot: initial,history,nickname,
    entries: await catalog.list(), canvas: { width: 1800, height: 1000 },
    adapters: { huya: adapter('huya'), douyu: adapter('douyu'), bilibili: adapter('bilibili') },
    publish: state => published.push(clone(state)), layoutChrome() {},
    resolveRoom: url => resolve(url), showMenu() {},
  });
  const track = <T>(promise: Promise<T>): Promise<T> => { operations.push(promise); return promise; };
  t.after(async () => {
    // Release every test-controlled wait before awaiting shutdown, even after an assertion fails.
    for (const release of cleanup) release();
    await Promise.allSettled(operations);
    catalog.saveHook = catalog.saveAsHook = catalog.openHook = undefined;
    await controller.shutdown(); // Clears controller media/debounce and adapter timers.
  });
  await controller.initialize();
  return { controller, runtime, catalog, published, target, cleanup, track,
    setResolver(next: Options['resolveRoom']) { resolve = next; } };
}

for (const type of ['openWorkspace', 'saveWorkspaceAs'] as const) {
  test(`failed current save prevents ${type} and retains the model and runtime identities`, async t => {
    const h = await harness(t);
    const selected = h.controller.state.workspace.stableOrder[1];
    await h.controller.command({ type: 'selectRoom', roomId: selected });
    await h.controller.command({ type: 'setZoom', roomId: selected, enabled: true });
    const before = h.controller.state;
    const identities = new Map(h.runtime.identities);
    h.catalog.saveHook = async () => { throw new Error('Sensitive disk path'); };
    const result = await h.controller.command(type === 'openWorkspace'
      ? { type, workspaceId: SECOND } : { type, name: 'Copy' });
    assert.equal(result.ok, false);
    assert.deepEqual(h.controller.state.workspace, before.workspace);
    assert.equal(h.controller.state.selectedId, selected); assert.equal(h.controller.state.zoomedId, selected);
    assert.equal(h.controller.state.saveStatus, 'error');
    assert.equal(h.catalog.opened.length, 0); assert.equal(h.catalog.saveAsInputs.length, 0);
    assert.equal(h.runtime.created.length, before.workspace.rooms.length); assert.deepEqual(h.runtime.closed, []);
    for (const [id, identity] of identities) assert.strictEqual(h.runtime.getRuntimeIdentity(id), identity);
    assert.deepEqual(h.runtime.audioCalls, []); assert.deepEqual(h.runtime.reloads, []);
    assert.ok(!JSON.stringify(result).includes('Sensitive') && !JSON.stringify(h.controller.state.message).includes('Sensitive'));
  });
}

for (const type of ['openWorkspace', 'saveWorkspaceAs'] as const) for (const phase of ['during', 'after'] as const) {
  test(`pending room resolution is discarded ${phase} ${type}`, async t => {
    const h = await harness(t);
    const resolver = deferred<Address>();
    h.cleanup.push(() => resolver.resolve(address));
    h.setResolver(() => resolver.promise);
    const adding = h.track(h.controller.command({ type: 'addRoom', url: address.canonicalUrl }));
    const gate = deferred<void>();
    h.cleanup.push(() => gate.resolve());
    if (phase === 'during') h.catalog.saveHook = () => gate.promise;
    const switching = h.track(h.controller.command(type === 'openWorkspace'
      ? { type, workspaceId: SECOND } : { type, name: 'Copy' }));
    if (phase === 'during') await until(() => h.catalog.saveAttempts.length === 1, 'switch must enter its save gate');
    else assert.equal((await switching).ok, true);
    resolver.resolve(address);
    assert.equal((await adding).ok, false);
    assert.ok(!h.controller.state.workspace.rooms.some(room => room.canonicalUrl === address.canonicalUrl));
    assert.ok(!h.runtime.created.some(room => room.canonicalUrl === address.canonicalUrl));
    gate.resolve();
    assert.equal((await switching).ok, true);
    assert.equal(h.controller.state.workspace.id, type === 'openWorkspace' ? SECOND : COPY);
    assert.equal(h.runtime.created.length, type === 'openWorkspace' ? 5 : 3);
  });
}

test('epoch rejects a late resolved add even when opening the same workspace ID', async t => {
  const h = await harness(t);
  const resolver = deferred<Address>();
  h.cleanup.push(() => resolver.resolve(address));
  h.setResolver(() => resolver.promise);
  const adding = h.track(h.controller.command({ type: 'addRoom', url: address.canonicalUrl }));
  assert.equal((await h.controller.command({ type: 'openWorkspace', workspaceId: FIRST })).ok, true);
  assert.equal(h.controller.state.workspace.id, FIRST);
  resolver.resolve(address);
  assert.equal((await adding).ok, false);
  assert.equal(h.controller.state.workspace.rooms.length, 3);
  assert.equal(h.runtime.created.length, 6);
  assert.ok(!h.runtime.created.some(room => room.canonicalUrl === address.canonicalUrl));
});

test('muteAll during save-as survives its stale copied snapshot and the final saved audio is false', async t => {
  const h = await harness(t);
  const gate = deferred<WorkspaceSnapshot>();
  const fallback = { ...h.controller.state.workspace, id: COPY, name: 'Copy' };
  h.cleanup.push(() => gate.resolve(clone(fallback)));
  h.catalog.saveAsHook = () => gate.promise;
  const identities = new Map(h.runtime.identities);
  let completed = false;
  const saving = h.track(h.controller.command({ type: 'saveWorkspaceAs', name: 'Copy' }).then(result => { completed = true; return result; }));
  await until(() => h.catalog.saveAsInputs.length === 1, 'save-as must capture old audio before mute');
  assert.ok(h.catalog.saveAsInputs[0].rooms.some(room => room.audio.allowed));
  assert.equal((await h.controller.command({ type: 'muteAll' })).ok, true);
  assert.equal(completed, false);
  assert.ok(h.controller.state.workspace.rooms.every(room => !room.audio.allowed));
  assert.deepEqual(h.runtime.audioCalls, [{ kind: 'muteAll' }]);
  gate.resolve({ ...clone(h.catalog.saveAsInputs[0]), id: COPY, name: 'Copy' });
  assert.equal((await saving).ok, true);
  assert.equal(h.controller.state.workspace.id, COPY);
  assert.ok(h.controller.state.workspace.rooms.every(room => !room.audio.allowed));
  const final = h.catalog.saveCommits.at(-1)!;
  assert.equal(final.id, COPY); assert.ok(final.rooms.every(room => !room.audio.allowed));
  assert.ok(h.catalog.stored.get(COPY)!.rooms.every(room => !room.audio.allowed));
  for (const [id, identity] of identities) assert.strictEqual(h.runtime.getRuntimeIdentity(id), identity);
  assert.equal(h.runtime.created.length, 3); assert.deepEqual(h.runtime.closed, []); assert.deepEqual(h.runtime.reloads, []);
});

test('muteAll during the final save-as write appends a latest muted save before reporting saved', async t => {
  const h = await harness(t);
  const gate = deferred<void>();
  h.cleanup.push(() => gate.resolve());
  h.catalog.saveHook = snapshot => snapshot.id === COPY ? gate.promise : Promise.resolve();
  const saving = h.track(h.controller.command({ type: 'saveWorkspaceAs', name: 'Copy' }));
  await until(() => h.catalog.saveAttempts.some(snapshot => snapshot.id === COPY), 'save-as must reach its final write');
  const captured = h.catalog.saveAttempts.filter(snapshot => snapshot.id === COPY);
  assert.equal(captured.length, 1);
  assert.ok(captured[0].rooms.some(room => room.audio.allowed), 'the blocked write must genuinely contain the older sound choice');
  assert.equal((await h.controller.command({ type: 'muteAll' })).ok, true);
  assert.equal(h.controller.state.saveStatus, 'saving');
  assert.ok(h.controller.state.workspace.rooms.every(room => !room.audio.allowed));
  gate.resolve();
  assert.equal((await saving).ok, true);
  const writes = h.catalog.saveAttempts.filter(snapshot => snapshot.id === COPY);
  assert.equal(writes.length, 2, 'a newer mute must trigger an additional serialized write');
  assert.ok(writes[1].rooms.every(room => !room.audio.allowed));
  assert.ok(h.catalog.saveCommits.at(-1)!.rooms.every(room => !room.audio.allowed));
  assert.ok(h.catalog.stored.get(COPY)!.rooms.every(room => !room.audio.allowed));
  assert.equal(h.controller.state.saveStatus, 'saved');
  assert.deepEqual(h.runtime.audioCalls, [{ kind: 'muteAll' }]);
  assert.equal(h.runtime.created.length, 3); assert.deepEqual(h.runtime.closed, []);
});

for (const writeFails of [false, true]) {
  test(`muteAll during failed open preserves the old workspace and ${writeFails ? 'reports its retry save error' : 'automatically saves the muted state'}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const h = await harness(t);
    const identities = new Map(h.runtime.identities);
    const gate = deferred<void>();
    h.cleanup.push(() => gate.resolve());
    h.catalog.openHook = async () => { await gate.promise; throw new Error('Open failed'); };
    if (writeFails) h.catalog.saveHook = async snapshot => {
      if (snapshot.rooms.every(room => !room.audio.allowed)) throw new Error('Muted retry save failed');
    };
    const opening = h.track(h.controller.command({ type: 'openWorkspace', workspaceId: SECOND }));
    await until(() => h.catalog.opened.length === 1, 'open should wait after its initial successful save');
    assert.ok(h.catalog.stored.get(FIRST)!.rooms.some(room => room.audio.allowed));
    assert.equal((await h.controller.command({ type: 'muteAll' })).ok, true);
    gate.resolve();
    assert.equal((await opening).ok, false);
    assert.equal(h.controller.state.workspace.id, FIRST);
    assert.ok(h.controller.state.workspace.rooms.every(room => !room.audio.allowed));
    assert.equal(h.controller.state.saveStatus, 'saving', 'an older audible write must not be presented as the latest saved state');
    // Exercise the scheduled retry rather than manually calling flushSave and masking a missing reschedule.
    t.mock.timers.tick(300);
    await until(() => h.controller.state.saveStatus !== 'saving', 'failed open must schedule persistence of the intervening mute');
    if (writeFails) {
      assert.equal(h.controller.state.saveStatus, 'error');
      assert.ok(h.controller.state.message?.level === 'error');
    } else {
      assert.equal(h.controller.state.saveStatus, 'saved');
      assert.ok(h.catalog.stored.get(FIRST)!.rooms.every(room => !room.audio.allowed));
      assert.equal(h.catalog.saveCommits.at(-1)!.id, FIRST);
    }
    for (const [id, identity] of identities) assert.strictEqual(h.runtime.getRuntimeIdentity(id), identity);
    assert.equal(h.runtime.created.length, 3); assert.deepEqual(h.runtime.closed, []);
    assert.deepEqual(h.runtime.audioCalls, [{ kind: 'muteAll' }]);
  });
}

test('shutdown releases runtime before an already pending save completes and rejects further controls', async t => {
  const h = await harness(t);
  assert.ok([...h.runtime.getAudioAllowed().values()].some(Boolean), 'fixture begins with permitted audio');
  const gate = deferred<void>();
  h.cleanup.push(() => gate.resolve());
  h.catalog.saveHook = () => gate.promise;
  const blockedSave = h.track(h.controller.flushSave());
  await until(() => h.catalog.saveAttempts.length === 1, 'save should remain blocked for the observation');
  let finished = false;
  const shuttingDown = h.track(h.controller.shutdown().then(() => { finished = true; }));
  assert.equal(h.runtime.disposals, 1, 'dispose must occur synchronously before waiting for the stalled write');
  assert.equal(h.runtime.identities.size, 0);
  assert.ok(![...h.runtime.getAudioAllowed().values()].some(Boolean));
  await Promise.resolve(); assert.equal(finished, false);
  assert.equal((await h.controller.command({ type: 'muteAll' })).ok, false);
  assert.deepEqual(h.runtime.audioCalls, []);
  // The write is deliberately unresolved until after all lifecycle assertions.
  gate.resolve();
  await Promise.all([blockedSave, shuttingDown]);
  await h.controller.shutdown(); assert.equal(h.runtime.disposals, 1);
});

test('layout, selection, native/zoom and focus events never request audio changes, reloads or room recreation', async t => {
  const h = await harness(t);
  const [first, second, third] = h.controller.state.workspace.stableOrder;
  const identities = new Map(h.runtime.identities);
  const originalAudio = h.controller.state.workspace.rooms.map(room => room.audio.allowed);
  const commands: AppCommand[] = [
    { type: 'setTemplate', template: 'focus' }, { type: 'setPrimary', roomId: second },
    { type: 'selectRoom', roomId: third }, { type: 'setFree' }, { type: 'raiseRoom', roomId: second },
    { type: 'setZoom', roomId: first, enabled: true }, { type: 'setZoom', roomId: first, enabled: false },
    { type: 'setNative', roomId: second, enabled: true }, { type: 'setNative', roomId: second, enabled: false },
    { type: 'geometryBegin', roomId: third, gestureId: 'controller-drag', kind: 'move' },
    { type: 'geometryDelta', roomId: third, gestureId: 'controller-drag', dx: 50, dy: 30 },
    { type: 'geometryEnd', roomId: third, gestureId: 'controller-drag' },
    { type: 'arrange' }, { type: 'undoGeometry' }, { type: 'setChat', roomId: first, visible: true },
    { type: 'setAllChat', visible: false }, { type: 'setChatWidth', roomId: first, widthDip: 320 },
  ];
  for (const command of commands) {
    assert.equal((await h.controller.command(command)).ok, true, command.type);
    assert.equal(Object.keys(h.controller.state.geometry.rooms).length, 3);
  }
  h.controller.event({ kind: 'focus', identity: identities.get(second)! });
  h.controller.resize({ width: 1300, height: 800 });
  assert.equal(h.controller.state.selectedId, second);
  assert.deepEqual(h.controller.state.workspace.rooms.map(room => room.audio.allowed), originalAudio);
  assert.deepEqual(h.runtime.audioCalls, []); assert.deepEqual(h.runtime.reloads, []); assert.deepEqual(h.runtime.closed, []);
  assert.equal(h.runtime.created.length, 3);
  for (const [id, identity] of identities) assert.strictEqual(h.runtime.getRuntimeIdentity(id), identity);
  assert.ok(h.runtime.bounds.length > commands.length);
  assert.ok(Object.values(h.controller.state.runtime).every(state => state.documentNavigations === 0));
});

for(const phase of ['initialize','open'] as const)test(`partial creation failure during ${phase} leaves successful rooms laid out and can retry only the failed room`,async t=>{
  const initial=sample();
  const target=phase==='initialize'?initial:sample(SECOND,2,50);
  const failed=target.stableOrder[1];
  const h=await harness(t,initial,phase==='initialize'?[failed]:[]);
  if(phase==='open'){
    h.runtime.failIds.add(failed);
    const before=h.runtime.bounds.length;
    assert.equal((await h.controller.command({type:'openWorkspace',workspaceId:SECOND})).ok,true);
    assert.ok(h.runtime.bounds.length>before,'partial open must still apply the visible layout');
  }
  assert.equal(h.controller.state.workspace.id,target.id);
  assert.equal(h.controller.state.workspace.rooms.length,target.rooms.length);
  assert.ok(h.runtime.bounds.length>0);
  assert.equal(h.runtime.identities.size,target.rooms.length-1);
  assert.equal(h.controller.state.runtime[failed].webContentsId,0);
  assert.equal(h.controller.state.runtime[failed].navigation,'error');
  assert.doesNotMatch(JSON.stringify(h.controller.state),/Sensitive/);
  const successful=new Map(h.runtime.identities);
  assert.equal((await h.controller.command({type:'reloadRoom',roomId:failed})).ok,false);
  assert.equal(h.controller.state.runtime[failed].navigation,'error');
  h.runtime.failIds.delete(failed);
  assert.equal((await h.controller.command({type:'reloadRoom',roomId:failed})).ok,true);
  assert.ok(h.controller.state.runtime[failed].generation>0);
  assert.ok(h.controller.state.runtime[failed].webContentsId>0);
  for(const [id,identity]of successful)assert.strictEqual(h.runtime.getRuntimeIdentity(id),identity);
  assert.deepEqual(h.runtime.reloads,[]);
  h.controller.event({kind:'navigation',identity:h.runtime.getRuntimeIdentity(failed)!,state:'ready',documentNavigations:1});
  assert.equal(h.controller.state.runtime[failed].navigation,'ready');
});

test('canonical history selects an already running legacy short ID without creating, layout or audio changes',async t=>{
  const initial=sample(FIRST,1);Object.assign(initial.rooms[0],{platform:'bilibili',platformRoomId:'6',canonicalUrl:'https://live.bilibili.com/6'});const history=historyFake();let records=0;history.record=async()=>{records++;};
  const h=await harness(t,initial,[],history),before=h.controller.state,creates=h.runtime.created.length,bounds=h.runtime.bounds.length;
  await h.controller.command({type:'setHistoryOpen',open:true});const result=await h.controller.command({type:'addHistoryRoom',historyId:history.state.entries[0].id});
  assert.equal(result.ok,true);assert.equal(h.runtime.created.length,creates);assert.equal(h.runtime.bounds.length,bounds);assert.equal(h.controller.state.selectedId,initial.rooms[0].id);assert.equal(h.controller.state.historyOpen,false);assert.deepEqual(h.controller.state.workspace,before.workspace);assert.deepEqual(h.runtime.audioCalls,[]);assert.equal(records,0);
});

test('history disk latency does not delay a new room layout, response or workspace save scheduling',async t=>{
  const history=historyFake();let release!:()=>void;const blocked=new Promise<void>(r=>{release=r;});history.record=()=>blocked;
  const h=await harness(t,sample(),[],history);h.cleanup.push(release);const bounds=h.runtime.bounds.length;
  const result=await h.controller.command({type:'addRoom',url:address.canonicalUrl});assert.equal(result.ok,true);assert.equal(h.controller.state.workspace.rooms.length,4);assert.ok(h.runtime.bounds.length>bounds);assert.equal(h.controller.state.saveStatus,'saving');assert.equal(h.runtime.created.at(-1)?.audio.allowed,false);
});

test('anchor lookup is background-only and a late name changes no room geometry, runtime, audio or saved config',async t=>{
  const pending=deferred<string|undefined>(),initial=sample(FIRST,1);const h=await harness(t,initial,[],undefined,()=>pending.promise);h.cleanup.push(()=>pending.resolve(undefined));
  const before=h.controller.state,identities=new Map(h.runtime.identities),bounds=h.runtime.bounds.length;
  assert.equal(before.runtime[initial.rooms[0].id].anchorNickname,undefined);assert.ok(bounds>0);
  pending.resolve('主播昵称');await until(()=>h.controller.state.runtime[initial.rooms[0].id]?.anchorNickname==='主播昵称','late nickname is published');
  assert.deepEqual(h.controller.state.workspace,before.workspace);assert.deepEqual(h.controller.state.geometry,before.geometry);assert.deepEqual(h.runtime.identities,identities);assert.equal(h.runtime.bounds.length,bounds);assert.deepEqual(h.runtime.audioCalls,[]);
});

test('titles keep a confirmed anchor name after deleting or clearing history, and reject unsafe names',async t=>{
  const initial=sample(FIRST,1),room=initial.rooms[0],history=historyFake();history.state.entries.splice(0,1,{...history.state.entries[0],platform:room.platform,platformRoomId:room.platformRoomId,canonicalUrl:room.canonicalUrl,nickname:'已保存主播'});
  history.clear=async()=>{history.state.entries.length=0;};const h=await harness(t,initial,[],history);
  assert.equal(h.controller.state.runtime[room.id].anchorNickname,'已保存主播');
  h.controller.updateAnchorNickname(room,'最新主播');assert.equal(h.controller.state.runtime[room.id].anchorNickname,'最新主播');
  await h.controller.command({type:'clearHistory'});assert.equal(h.controller.state.runtime[room.id].anchorNickname,'最新主播');assert.deepEqual(h.controller.state.workspace,initial);
  h.controller.updateAnchorNickname(room,'invalid\nname');h.controller.updateAnchorNickname(room,'\u202eunsafe');assert.equal(h.controller.state.runtime[room.id].anchorNickname,'最新主播');assert.deepEqual(h.runtime.audioCalls,[]);
});

test('removed and switched rooms cannot receive a stale nickname or recreate their runtime state',async t=>{
  const pending=deferred<string|undefined>(),initial=sample(FIRST,1);const h=await harness(t,initial,[],undefined,()=>pending.promise);h.cleanup.push(()=>pending.resolve(undefined));
  const removed=initial.rooms[0].id;await h.controller.command({type:'removeRoom',roomId:removed});await h.controller.command({type:'openWorkspace',workspaceId:SECOND});
  pending.resolve('公开主播');await until(()=>h.controller.state.workspace.rooms.every(room=>h.controller.state.runtime[room.id]?.anchorNickname==='公开主播'),'new-room name requests complete');
  assert.equal(h.controller.state.runtime[removed],undefined);assert.equal(h.controller.state.workspace.rooms.some(room=>room.id===removed),false);
});

test('anchor title lookup canonicalizes a legacy short room without replacing its running instance',async t=>{
  const initial=sample(FIRST,1);Object.assign(initial.rooms[0],{platform:'bilibili',platformRoomId:'6',canonicalUrl:'https://live.bilibili.com/6'});const requested:string[]=[];
  const h=await harness(t,initial,[],historyFake(),async address=>{requested.push(address.platformRoomId);return 'B站主播';});
  await until(()=>h.controller.state.runtime[initial.rooms[0].id]?.anchorNickname==='B站主播','canonical name arrives');assert.deepEqual(requested,['7734200']);assert.equal(h.runtime.created.length,1);assert.deepEqual(h.runtime.reloads,[]);assert.deepEqual(h.runtime.audioCalls,[]);
});

test('legacy anchor identity retries a transient failure and recovers after later history confirmation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const initial=sample(FIRST,1);Object.assign(initial.rooms[0],{platform:'bilibili',platformRoomId:'6',canonicalUrl:'https://live.bilibili.com/6'});
  const history=historyFake(),canonical=history.state.entries[0];let identityCalls=0,available=false;
  history.resolveIdentity=async()=>{identityCalls++;if(!available)throw Error('temporary');return canonical;};
  const h=await harness(t,initial,[],history,async()=>'恢复主播');await until(()=>identityCalls===1,'initial identity fails');available=true;t.mock.timers.tick(1000);
  await until(()=>h.controller.state.runtime[initial.rooms[0].id]?.anchorNickname==='恢复主播','automatic identity retry recovers');assert.equal(identityCalls,2);assert.equal(h.runtime.created.length,1);assert.deepEqual(h.runtime.reloads,[]);
  // Also recover after all three initial attempts, without rebuilding playback.
  available=false;await h.controller.command({type:'reloadRoom',roomId:initial.rooms[0].id});await until(()=>identityCalls===3,'retry after explicit reload');t.mock.timers.tick(1000);await until(()=>identityCalls===4,'second unavailable attempt');t.mock.timers.tick(4000);await until(()=>identityCalls===5,'third unavailable attempt');
  for(let i=0;i<10;i++)await Promise.resolve();available=true;h.controller.updateAnchorNickname(canonical,'恢复后的新昵称');await until(()=>identityCalls===6,'history confirmation reassociates old short room');
  await until(()=>h.controller.state.runtime[initial.rooms[0].id]?.anchorNickname==='恢复主播','reassociated consumer resolves name');assert.equal(h.runtime.created.length,1);
});
