import type { AppCommand, AppState } from '../../shared/app-contracts.ts';
import { roomLabel } from '../../shared/app-contracts.ts';
import { connectState } from '../components/bridge.ts';
import { button, element, pressed } from '../components/dom.ts';
import { createHistoryPanel } from './history-panel.ts';

document.body.className = 'toolbar-page';
const root = document.getElementById('app');
if (!root) throw new Error('Missing app root');
const toolbar = element('main', 'toolbar');
toolbar.setAttribute('aria-label', '直播工作台');
const top = element('div', 'toolbar-row toolbar-top');
const brand = element('div', 'brand', 'LIVE UNION');
const workspaceGroup = element('div', 'control-group workspace-group');
const workspacePicker = element('select', 'workspace-picker');
workspacePicker.setAttribute('aria-label', '切换房间组合');
const name = element('input', 'workspace-name');
name.type = 'text'; name.maxLength = 80; name.placeholder = '组合名称';
name.setAttribute('aria-label', '组合名称');
let state: AppState | undefined;
let pendingAdd = false;
const error = element('span', 'feedback');
error.setAttribute('role', 'status');
error.setAttribute('aria-live', 'polite');
const report = (message: string) => { error.textContent = message; };
const send = (command: AppCommand) => connection.send(command);
const rename = button('改名', '重命名当前组合', () => saveName('renameWorkspace'));
const saveAs = button('另存', '将当前房间与布局另存为新组合', () => saveName('saveWorkspaceAs'));
function saveName(type: 'renameWorkspace' | 'saveWorkspaceAs') {
  const value = name.value.trim();
  if (!value) { report('请输入组合名称。'); name.focus(); return; }
  error.textContent = '';
  void send({ type, name: value });
}
workspacePicker.addEventListener('change', () => {
  if (!workspacePicker.value || workspacePicker.value === state?.workspace.id) return;
  error.textContent = '';
  void send({ type: 'openWorkspace', workspaceId: workspacePicker.value });
});
name.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); saveName('renameWorkspace'); }
});
workspaceGroup.append(workspacePicker, name, rename, saveAs);
const addForm = element('form', 'add-room');
const url = element('input', 'room-url');
url.type = 'url'; url.placeholder = '粘贴虎牙 / 斗鱼 / B站直播链接';
url.required = true; url.autocomplete = 'off'; url.spellcheck = false;
url.setAttribute('aria-label', '直播间链接');
const add = element('button', 'accent', '添加房间');
add.type = 'submit';
const history = button('历史', '打开可搜索的直播间历史', () => historyPanel.toggle(), 'history-toggle');
history.setAttribute('aria-controls', 'room-history');
history.setAttribute('aria-expanded', 'false');
const historyPanel = createHistoryPanel(send, () => history.focus({ preventScroll: true }));
addForm.append(url, history, add);
addForm.addEventListener('submit', async event => {
  event.preventDefault();
  const value = url.value.trim();
  if (!value || pendingAdd) return;
  pendingAdd = true; add.disabled = true; error.textContent = '';
  const result = await send({ type: 'addRoom', url: value });
  pendingAdd = false; add.disabled = false;
  if (result?.ok && url.value.trim() === value) url.value = '';
  url.focus();
});
top.append(brand, workspaceGroup, addForm);
const controls = element('nav', 'toolbar-row toolbar-controls');
controls.setAttribute('aria-label', '布局和全局控制');
const layouts = element('div', 'control-group layout-group');
const equal = button('等大', '按房间外框等大排列', () => { void send({ type: 'setTemplate', template: 'equal' }); });
const focus = button('主视角', '一主多副排列', () => { void send({ type: 'setTemplate', template: 'focus' }); });
const free = button('自由编辑', '恢复自由布局；首次使用从当前排列开始', () => { void send({ type: 'setFree' }); });
const fromCurrent = button('从当前排列编辑', '以当前排列重新开始自由编辑', () => { void send({ type: 'setFree', fromCurrent: true }); });
layouts.append(equal, focus, free, fromCurrent);
const geometry = element('div', 'control-group');
const arrange = button('一键整理', '整理房间位置，保留声音和聊天选择', () => { void send({ type: 'arrange' }); });
const undo = button('撤销', '撤销最近的几何调整', () => { void send({ type: 'undoGeometry' }); });
geometry.append(arrange, undo);
const mute = button('全部静音', '关闭所有房间的软件声音许可', () => { void send({ type: 'muteAll' }); }, 'mute-all');
const chatOpen = button('展开聊天', '展开每个房间的原生聊天侧栏', () => { void send({ type: 'setAllChat', visible: true }); });
const chatClose = button('收起聊天', '收起每个房间的聊天侧栏，保留飘屏弹幕', () => { void send({ type: 'setAllChat', visible: false }); });
const full = button('全屏', '切换应用全屏', () => { void send({ type: 'toggleFullscreen' }); });
const retry = button('重试未创建房间', '只重新创建此前失败的房间，其余直播继续运行', async () => {
  const ids=state?.workspace.rooms.filter(room=>state?.runtime[room.id]?.webContentsId===0).map(room=>room.id)??[];
  for(const roomId of ids)await send({type:'reloadRoom',roomId});
});
retry.hidden=true;
controls.append(layouts, geometry, mute, chatOpen, chatClose, full, retry);
const status = element('div', 'toolbar-row toolbar-status');
const summary = element('span', 'workspace-summary', '正在连接本地工作台…');
const hint = element('span', 'workspace-hint');
const save = element('span', 'save-status');
const chatSize=element('label','chat-size');chatSize.append(element('span','','所选侧栏'));
const chatRange=element('input');chatRange.type='range';chatRange.min='140';chatRange.max='500';chatRange.step='10';chatRange.setAttribute('aria-label','所选房间聊天侧栏宽度');
const chatSizeText=element('output');chatSize.append(chatRange,chatSizeText);
let widthTimer:ReturnType<typeof setTimeout>|undefined;
let pendingWidth:{roomId:string;widthDip:number}|undefined;
function flushWidth(){if(widthTimer)clearTimeout(widthTimer);widthTimer=undefined;const value=pendingWidth;pendingWidth=undefined;if(value)void send({type:'setChatWidth',...value});}
chatRange.addEventListener('input',()=>{const roomId=state?.selectedId;if(!roomId)return;pendingWidth={roomId,widthDip:Number(chatRange.value)};chatSizeText.textContent=`${chatRange.value} DIP`;if(!widthTimer)widthTimer=setTimeout(flushWidth,100);});
chatRange.addEventListener('change',flushWidth);
status.append(summary, hint, error, chatSize, save);
toolbar.append(top, controls, status); root.append(toolbar, historyPanel.element);
const emptyWorkspace = element('section', 'empty-workspace');
const emptyMark = element('div', 'empty-mark', 'LU');
emptyMark.setAttribute('aria-hidden', 'true');
const emptyTitle = element('h1', '', '把不同视角放在一起');
const emptyDescription = element('p', '', '粘贴虎牙、斗鱼或哔哩哔哩直播链接，开始你的多视角工作台。');
const emptyAction = button('添加第一个直播间', '定位到顶部直播间链接输入框', () => url.focus(), 'accent');
const emptyNote = element('p', 'empty-note', '新房间先静音 · 登录、清晰度与聊天保留平台原生体验');
emptyWorkspace.append(emptyMark, emptyTitle, emptyDescription, emptyAction, emptyNote);
root.append(emptyWorkspace);
let workspaceSignature = '';
let workspaceId = '';

function render(next: AppState) {
  state = next;
  history.setAttribute('aria-expanded', String(next.historyOpen === true));
  historyPanel.update(next);
  const workspace = next.workspace;
  const signature = JSON.stringify(next.workspaces);
  if (signature !== workspaceSignature) {
    workspaceSignature = signature;
    workspacePicker.replaceChildren(...next.workspaces.map(entry => {
      const option = element('option', '', entry.name); option.value = entry.id; return option;
    }));
  }
  workspacePicker.value = workspace.id;
  if (workspaceId !== workspace.id || document.activeElement !== name) name.value = workspace.name;
  workspaceId = workspace.id;
  const editing = workspace.layout.editing === 'free';
  pressed(equal, !editing && workspace.layout.base === 'equal');
  pressed(focus, !editing && workspace.layout.base === 'focus'); pressed(free, editing);
  undo.disabled = !next.undoAvailable;
  const empty = workspace.rooms.length === 0;
  retry.hidden=!workspace.rooms.some(room=>next.runtime[room.id]?.webContentsId===0);
  emptyWorkspace.hidden = !empty;
  for (const control of [arrange, mute, chatOpen, chatClose, fromCurrent]) control.disabled = empty;
  const selected = workspace.rooms.find(room => room.id === next.selectedId);
  chatSize.hidden=!selected;chatRange.disabled=!selected;
  if(selected&&!pendingWidth){chatRange.value=String(selected.chat.preferredWidthDip);chatSizeText.textContent=`${selected.chat.preferredWidthDip} DIP`;}
  const primary = workspace.rooms.find(room => room.id === workspace.layout.primaryRoomId);
  const mode = editing ? '自由编辑' : workspace.layout.base === 'focus' ? '主视角' : '等大排列';
  summary.textContent = `${workspace.rooms.length} 路 · ${mode}${selected ? ` · 选中 ${roomLabel(selected, next.runtime[selected.id]?.anchorNickname)}` : ''}${primary ? ` · 主房间 ${roomLabel(primary, next.runtime[primary.id]?.anchorNickname)}` : ''}`;
  summary.title = summary.textContent;
  const unverified = workspace.rooms.some(room => {
    const runtime = next.runtime[room.id];
    return !runtime || Object.values(runtime.capabilities).includes('unknown');
  });
  hint.textContent = next.geometry.spaceConstrained ? '空间不足：可收起聊天、放大单间或整理布局' :
    next.message?.text || (empty ? '添加直播间开始观看 · 新房间先静音' : unverified ? '部分平台能力未知，以原生页面为准' : '聊天、清晰度与登录在各房间原生页面操作');
  hint.classList.toggle('warning', next.geometry.spaceConstrained || next.message?.level === 'warning' || next.message?.level === 'error');
  save.textContent = { saved: '已保存', saving: '保存中…', error: '保存失败' }[next.saveStatus];
  save.classList.toggle('warning', next.saveStatus === 'error');
}
const connection = connectState(window.liveUnion, render, report);
window.addEventListener('pagehide', () => {if(widthTimer)clearTimeout(widthTimer);historyPanel.dispose();connection.dispose();}, { once: true });
