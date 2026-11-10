import type { AppCommand, AppState, RoomRuntimeState } from '../../shared/app-contracts.ts';
import { roomDisplayName, roomLabel } from '../../shared/app-contracts.ts';
import { connectState } from '../components/bridge.ts';
import { button, element, pressed, renameButton } from '../components/dom.ts';
import { geometryGesture } from './geometry-gesture.ts';

document.body.className = 'room-page';
const root = document.getElementById('app');
if (!root) throw new Error('Missing app root');
const query = new URLSearchParams(window.location.search);
const roomId = query.get('roomId') || query.get('id') || '';
let state: AppState | undefined;
let alive = false;
const shell = element('section', 'room-shell');
shell.setAttribute('aria-label', '直播房间控制');
const header = element('header', 'room-header');
header.title = '拖动标题栏交换位置；自由编辑时移动房间';
header.tabIndex = 0;
header.setAttribute('aria-label', '房间拖柄；自由编辑时可用方向键移动，Shift加方向键精调');
const grip = element('span', 'drag-grip', '⠿');
grip.setAttribute('aria-hidden', 'true');
const identity = element('div', 'room-identity');
const platform = element('span', 'platform-label');
platform.dataset.noDrag = '';
const label = element('span', 'room-label', '正在连接…');
label.dataset.noDrag = '';
identity.append(platform, label);
const observation = element('span', 'room-observation');
observation.dataset.noDrag = '';
const actions = element('div', 'room-actions');
const send = (command: AppCommand) => connection.send(command);
const command = (type: 'soloAudio' | 'showRoomMenu' | 'removeRoom') => {
  if (alive) void send({ type, roomId });
};
const audio = button('静音', '允许此房间发声', () => {
  const room = state?.workspace.rooms.find(item => item.id === roomId);
  if (room) void send({ type: 'setAudio', roomId, allowed: !room.audio.allowed });
}, 'room-audio');
const solo = button('独听', '只允许此房间发声', () => command('soloAudio'), 'room-solo');
const chat = button('聊天', '展开此房间原生聊天侧栏', () => {
  const room = state?.workspace.rooms.find(item => item.id === roomId);
  if (room) void send({ type: 'setChat', roomId, visible: !room.chat.visible });
}, 'room-chat');
const primary = button('主', '设为主视角，不改变声音', () => {
  if (alive) void send({ type: 'setPrimary', roomId });
}, 'room-primary');
const zoom = button('放大', '临时放大此房间，不改变声音', () => {
  if (alive) void send({ type: 'setZoom', roomId, enabled: state?.zoomedId !== roomId });
}, 'room-zoom');
const native = button('原页', '恢复完整原生网页以登录或操作平台功能', () => {
  if (alive) void send({ type: 'setNative', roomId, enabled: state?.nativeRoomId !== roomId });
}, 'room-native');
const more = button('⋯', '更多房间操作（原生菜单）', () => command('showRoomMenu'), 'room-more');
more.setAttribute('aria-haspopup', 'menu');
const close = button('×', '关闭此房间并停止播放', () => command('removeRoom'), 'room-close');
actions.append(audio, solo, chat, primary, zoom, native, more, close);
header.append(grip, identity, observation, actions);
// This area is behind the native remote view. It never imitates a player or chat.
const content = element('div', 'native-content');
content.setAttribute('aria-hidden', 'true');
const feedback = element('span', 'room-feedback');
feedback.setAttribute('role', 'status');
feedback.setAttribute('aria-live', 'polite');
header.append(feedback);
const footer = element('div', 'room-footer');
const resize = element('button', 'resize-handle');
resize.type = 'button'; resize.title = '自由编辑：拖动或用方向键调整房间大小，Shift加方向键精调';
resize.setAttribute('aria-label', '调整房间大小；方向键调整，Shift加方向键精调');
footer.append(resize); shell.append(header, content, footer); root.append(shell);

function runtimeText(runtime: RoomRuntimeState | undefined) {
  if (!runtime) return '能力未知';
  if (runtime.navigation === 'error' || runtime.live === 'failed') return '加载失败 · 更多可重试';
  if (runtime.live === 'offline') return '已离线';
  if (runtime.navigation === 'loading') return '加载中';
  if (runtime.media?.paused) return '原生播放器已暂停';
  if (runtime.adaptation === 'degraded' || runtime.adaptation === 'unsupported') return '兼容受限 · 可用原页';
  if (runtime.login === 'challenge') return '平台需要验证';
  if (runtime.live === 'buffering') return '缓冲中';
  return runtime.live === 'live' ? '直播中' : '直播状态未知';
}

function render(next: AppState) {
  state = next;
  const room = next.workspace.rooms.find(item => item.id === roomId);
  alive = !!room;
  for (const control of [audio, solo, chat, primary, zoom, native, more, close]) control.disabled = !room;
  const free = next.workspace.layout.editing === 'free';
  resize.disabled = !room || !free || next.zoomedId === roomId || next.nativeRoomId === roomId;
  footer.classList.toggle('can-resize', !resize.disabled);
  if (!room) { label.textContent = roomId ? '房间已关闭' : '房间标识缺失'; return; }
  const runtime = next.runtime[roomId];
  const title = roomLabel(room, runtime?.anchorNickname);
  const identityHint = `${title}；房号 ${room.platformRoomId}；${room.canonicalUrl}`;
  label.textContent = roomDisplayName(room, runtime?.anchorNickname);
  platform.textContent = { huya: '虎牙', douyu: '斗鱼', bilibili: 'B站' }[room.platform];
  platform.dataset.platform = room.platform;
  identity.title = identityHint;
  shell.setAttribute('aria-label', `${title} · 房间控制`);
  shell.classList.toggle('is-selected', next.selectedId === roomId);
  shell.classList.toggle('is-primary', next.workspace.layout.primaryRoomId === roomId);
  shell.classList.toggle('is-free', free);
  pressed(audio, room.audio.allowed);
  const audioActivity = runtime ? runtime.pageAudioActive ? '页面检测到音频活动' : '页面未检测到音频活动' : '页面音频活动未知';
  const containerAudio = runtime ? runtime.containerMuted ? '容器当前静音' : '容器当前未静音' : '容器静音状态未知';
  renameButton(audio, room.audio.allowed ? '可发声' : '静音', `${room.audio.allowed ? '已允许发声，点击静音' : '未允许发声，点击允许发声'}；${containerAudio}；${audioActivity}；页面活动不代表扬声器实际发声`);
  audio.dataset.activity = String(runtime?.pageAudioActive ?? false);
  pressed(chat, room.chat.visible);
  renameButton(chat, '聊天', `${room.chat.visible ? '收起' : '展开'}此房间原生聊天侧栏，不改变飘屏弹幕`);
  pressed(primary, next.workspace.layout.primaryRoomId === roomId);
  pressed(zoom, next.zoomedId === roomId);
  renameButton(zoom, next.zoomedId === roomId ? '还原' : '放大', next.zoomedId === roomId ? '退出临时放大，恢复之前排列' : '临时放大此房间，不改变声音');
  pressed(native, next.nativeRoomId === roomId);
  renameButton(native, next.nativeRoomId === roomId ? '整理' : '原页', next.nativeRoomId === roomId ? '退出完整原生网页模式' : '完整原生网页：登录、清晰度与平台操作');
  const status = runtimeText(runtime);
  observation.textContent = status;
  observation.title=runtime?.message??'';
  const login = runtime ? { unknown: '登录状态未知', signedOut: '平台未登录', signedIn: '检测到已登录', challenge: '平台需要验证' }[runtime.login] : '登录状态未知';
  const capabilityNames = { nativePlayback: '原生播放', nativeChat: '原生聊天', chatVisibility: '聊天侧栏开关', nativeDanmakuSettings: '飘屏弹幕设置', loginObservation: '登录状态检测', qualityObservation: '清晰度检测', volumeControl: '音量控制', compactPage: '页面整理' };
  const capabilities = runtime ? (Object.keys(runtime.capabilities) as (keyof typeof capabilityNames)[])
    .filter(key => runtime.capabilities[key] !== 'supported')
    .map(key => `${capabilityNames[key]}${runtime.capabilities[key] === 'unknown' ? '未知' : '暂不支持'}`).join('；') : '平台能力未知';
  header.title = `${identityHint}；${status}；${login}；${runtime?.message??''}；清晰度请查看原生播放器；${audioActivity}；${capabilities}。拖动空白标题栏${free ? '移动房间' : '交换位置'}`;
  // Only navigation/availability is reported. No guessed quality, account, or chat content.
}

let active: { pointerId: number; target: HTMLElement; gesture: ReturnType<typeof geometryGesture> } | undefined;
let pointerClick: { pointerId: number; expiresAt: number } | undefined;
let pointerClickTimer: ReturnType<typeof setTimeout> | undefined;
function clearPointerClick() {
  pointerClick = undefined;
  if (pointerClickTimer !== undefined) clearTimeout(pointerClickTimer);
  pointerClickTimer = undefined;
}
function rememberPointerClick(pointerId: number) {
  clearPointerClick();
  pointerClick = { pointerId, expiresAt: performance.now() + 500 };
  pointerClickTimer = setTimeout(clearPointerClick, 500);
}
function finish() {
  const previous = active;
  if (!previous) return;
  active = undefined;
  rememberPointerClick(previous.pointerId);
  previous.gesture.end();
  if (previous.target.hasPointerCapture(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId);
  shell.classList.remove('is-dragging');
}
function start(event: PointerEvent, kind: 'move' | 'resize', target: HTMLElement) {
  clearPointerClick();
  if (!alive || active || event.button !== 0 || !event.isPrimary) return;
  if (kind === 'move') {
    const source = event.target;
    if (!(source instanceof Element) || source.closest('button,input,select,textarea,a,[contenteditable],[data-no-drag]')) return;
    if (window.getSelection()?.toString()) return;
  } else if (resize.disabled) return;
  event.preventDefault();
  target.focus({preventScroll:true});
  // Selection/raising has no audio side effects. Geometry policy belongs to the controller.
  void send({ type: 'selectRoom', roomId });
  void send({ type: 'raiseRoom', roomId });
  const gesture = geometryGesture({
    roomId, gestureId: crypto.randomUUID(), kind, x: event.screenX, y: event.screenY, send,
    frames: { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) },
  });
  active = { pointerId: event.pointerId, target, gesture };
  shell.classList.add('is-dragging');
  try { target.setPointerCapture(event.pointerId); } catch { finish(); }
}
header.addEventListener('pointerdown', event => start(event, 'move', header));
resize.addEventListener('pointerdown', event => start(event, 'resize', resize));
function keyboardGeometry(event: KeyboardEvent, kind: 'move' | 'resize') {
  // Only the focused local handle receives these keys. Remote pages keep native IME/input.
  if (event.target !== (kind === 'move' ? header : resize) || event.isComposing ||
      event.ctrlKey || event.altKey || event.metaKey || active || !alive ||
      state?.workspace.layout.editing !== 'free' ||
      state.zoomedId === roomId || state.nativeRoomId === roomId) return;
  const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!direction) return;
  event.preventDefault();
  void send({ type: 'selectRoom', roomId });
  void send({ type: 'raiseRoom', roomId });
  const step = event.shiftKey ? 1 : 10;
  const gesture = geometryGesture({ roomId, gestureId: crypto.randomUUID(), kind, x: 0, y: 0, send,
    frames: { request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) },
  });
  gesture.move(direction[0] * step, direction[1] * step); gesture.end();
}
header.addEventListener('keydown', event => keyboardGeometry(event, 'move'));
resize.addEventListener('keydown', event => keyboardGeometry(event, 'resize'));
// Clicking text or a control selects this frame, while leaving native input untouched.
header.addEventListener('click', event => {
  const previous = pointerClick;
  clearPointerClick();
  if (!alive || (event.target instanceof Element && event.target.closest('button,input,select,textarea,a'))) return;
  // Pointerdown already selected/raised this frame. Repeating the raise here can
  // overtake queued geometryEnd and cancel its pending commit. detail=0 keeps
  // keyboard/UIA activation independent from pointer gestures.
  const pointerId = 'pointerId' in event ? event.pointerId : undefined;
  if (previous && event.detail > 0 && performance.now() <= previous.expiresAt
    && (pointerId === undefined || pointerId === previous.pointerId)) return;
  void send({ type: 'selectRoom', roomId });
  void send({ type: 'raiseRoom', roomId });
});
window.addEventListener('pointerdown', clearPointerClick, { capture: true });
window.addEventListener('pointermove', event => {
  if (active?.pointerId === event.pointerId) active.gesture.move(event.screenX, event.screenY);
});
window.addEventListener('pointerup', event => {
  if (active?.pointerId !== event.pointerId) return;
  active.gesture.move(event.screenX, event.screenY); finish();
});
window.addEventListener('pointercancel', event => { if (active?.pointerId === event.pointerId) finish(); });
header.addEventListener('lostpointercapture', event => { if (active?.pointerId === event.pointerId) finish(); });
resize.addEventListener('lostpointercapture', event => { if (active?.pointerId === event.pointerId) finish(); });
window.addEventListener('blur', finish);
const connection = connectState(window.liveUnion, render, message => { feedback.textContent = message; feedback.title = message; });
window.addEventListener('pagehide', () => { finish(); clearPointerClick(); connection.dispose(); }, { once: true });
