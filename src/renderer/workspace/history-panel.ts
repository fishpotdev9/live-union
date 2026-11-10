import type { AppCommand, AppState, CommandResult } from '../../shared/app-contracts.ts';
import { historyEntryLabel } from '../../shared/history-contracts.ts';
import type { RoomHistoryEntry } from '../../shared/history-contracts.ts';
import { button, element } from '../components/dom.ts';

const PAGE_SIZE = 40;
const PLATFORM_SEARCH = {
  huya: 'huya 虎牙',
  douyu: 'douyu 斗鱼',
  bilibili: 'bilibili 哔哩哔哩 哔哩 b站 b站直播 b 站',
};
function normalizeSearch(value: string): string { return value.normalize('NFKC').toLocaleLowerCase().trim(); }

/** Search the full snapshot before paging; never mutate or discard persisted entries. */
export function filterHistory(entries: readonly RoomHistoryEntry[], query: string): RoomHistoryEntry[] {
  const terms = normalizeSearch(query).split(/\s+/u).filter(Boolean);
  return entries.filter(entry => {
    const searchable = normalizeSearch(`${PLATFORM_SEARCH[entry.platform]} ${entry.nickname ?? ''} ${entry.platformRoomId} ${entry.canonicalUrl}`);
    return terms.every(term => searchable.includes(term));
  });
}
export function historyPage(entries: readonly RoomHistoryEntry[], query: string, limit = PAGE_SIZE) {
  const matches = filterHistory(entries, query);
  return { entries: matches.slice(0, Math.max(0, Math.floor(limit))), total: matches.length };
}

type Send = (command: AppCommand) => Promise<CommandResult | undefined>;
export function createHistoryPanel(send: Send, restoreFocus: () => void) {
  const panel = element('section', 'history-panel');
  panel.id = 'room-history'; panel.hidden = true;
  panel.setAttribute('aria-labelledby', 'room-history-title');
  const heading = element('div', 'history-heading');
  const title = element('h2', '', '直播间历史'); title.id = 'room-history-title';
  const description = element('p', 'history-description', '全组合共用 · 最近添加优先 · 点击添加，已打开的房间将定位');
  const close = button('关闭', '关闭直播间历史', () => { void setOpen(false); });
  heading.append(title, description, close);
  const tools = element('div', 'history-tools');
  const search = element('input', 'history-search');
  search.type = 'search'; search.placeholder = '搜索平台、主播昵称、房号或链接';
  search.autocomplete = 'off'; search.spellcheck = false;
  search.setAttribute('aria-label', '搜索直播间历史'); search.setAttribute('aria-controls', 'room-history-list');
  const count = element('span', 'history-count');
  const clear = button('清空历史', '清空全部历史记录，保留房间组合和播放偏好', () => {
    confirming = true; localError = ''; renderContent(); cancel.focus();
  });
  tools.append(search, count, clear);
  const notice = element('p', 'history-notice');
  notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const feedback = element('p', 'history-feedback');
  feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  const confirmation = element('div', 'history-confirmation'); confirmation.hidden = true;
  confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', '确认清空历史');
  const confirmText = element('p', '', '清空全部历史记录？已保存组合、当前房间和播放偏好都会保留。');
  const confirm = button('确认清空', '确认清空全部历史记录', () => { void run({ type: 'clearHistory' }); }, 'history-danger');
  const cancel = button('取消', '取消清空历史记录', () => { confirming = false; renderContent(); clear.focus(); });
  confirmation.append(confirmText, cancel, confirm);
  const results = element('div', 'history-results');
  const list = element('ul', 'history-list'); list.id = 'room-history-list';
  list.setAttribute('aria-label', '直播间历史列表');
  const empty = element('p', 'history-empty');
  const more = button('显示更多', '显示更多匹配的历史记录', () => {
    limit += PAGE_SIZE; renderContent();
    // Keep the pagination control reachable when it disappears on the final page.
    if (more.hidden) search.focus();
  }, 'history-more');
  results.append(list, empty, more);
  panel.append(heading, tools, notice, feedback, confirmation, results);
  let current: AppState | undefined;
  let open = false;
  let pendingOpen = false;
  let busy = false;
  let pendingId: string | undefined;
  let confirming = false;
  let localError = '';
  let limit = PAGE_SIZE;
  let signature = '';
  let disposed = false;
  let pendingFocus: { id: string; action: string } | undefined;
  let metadataSignature='';

  async function setOpen(value: boolean) {
    if (pendingOpen || disposed) return;
    pendingOpen = true;
    const result = await send({ type: 'setHistoryOpen', open: value });
    pendingOpen = false;
    if (!result?.ok) { localError = result && !result.ok ? result.error : '历史列表操作未完成，请重试。'; renderContent(); }
  }
  async function run(command: AppCommand, id?: string) {
    if (busy || current?.history?.status !== 'ready') return;
    busy = true; pendingId = id; localError = ''; renderContent();
    const result = await send(command);
    if (disposed) return;
    busy = false; pendingId = undefined;
    if (!result?.ok) {
      localError = result && !result.ok ? result.error : '操作未完成，请重试。';
      renderContent(); return;
    }
    confirming = false; renderContent();
    if (command.type === 'clearHistory' && open) search.focus({ preventScroll: true });
    if (command.type === 'addHistoryRoom' && open) await setOpen(false);
  }
  search.addEventListener('input', () => { limit = PAGE_SIZE; renderContent(); });
  search.addEventListener('keydown', event => {
    // Enter only edits the search; choosing a room requires an explicit button action.
    if (event.key === 'Enter' && !event.isComposing) event.preventDefault();
  });
  function onKeydown(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    if (confirming && !busy) { confirming = false; renderContent(); clear.focus(); }
    else void setOpen(false);
  }
  document.addEventListener('keydown', onKeydown);

  function renderContent() {
    const history = current?.history;
    const entries = history?.entries ?? [];
    const ready = history?.status === 'ready';
    const nextSignature = JSON.stringify([open, history?.status, entries, history?.warning, search.value, limit, busy, pendingId, confirming, localError]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const page = historyPage(entries, search.value, limit);
    const visibleIds=page.entries.slice(-40).map(entry=>entry.id),nextMetadataSignature=JSON.stringify(visibleIds);
    if(open&&ready&&metadataSignature!==nextMetadataSignature){metadataSignature=nextMetadataSignature;void send({type:'refreshHistoryMetadata',historyIds:visibleIds});}
    panel.setAttribute('aria-busy', String(busy || !history || history.status === 'loading'));
    clear.disabled = !ready || busy || entries.length === 0 || confirming;
    confirm.disabled = !ready || busy;
    cancel.disabled = busy;
    confirmation.hidden = !confirming;
    count.textContent = ready ? `${page.total} 条${search.value.trim() ? '匹配' : '历史'}` : '';
    notice.textContent = !history || history.status === 'loading' ? '正在读取本机历史记录…' :
      history.status === 'error' ? `历史记录读取失败。${history.warning ?? '请稍后重试或重新启动应用。'}` : history.warning ?? '';
    notice.classList.toggle('warning', history?.status === 'error' || Boolean(history?.warning));
    notice.hidden = !notice.textContent;
    feedback.textContent = localError || (busy ? pendingId ? '正在处理此房间…' : '正在清空历史…' : '');
    feedback.hidden = !feedback.textContent;
    feedback.classList.toggle('warning', Boolean(localError));
    const active = document.activeElement instanceof HTMLButtonElement && list.contains(document.activeElement) ? document.activeElement : undefined;
    const activeId = active?.dataset.historyId;
    const activeAction = active?.dataset.historyAction;
    if (activeId && activeAction) pendingFocus = { id: activeId, action: activeAction };
    const nodes = page.entries.map(entry => {
      const row = element('li', 'history-entry');
      const label = historyEntryLabel(entry);
      const room = button('', `添加或定位 ${label}，房号 ${entry.platformRoomId}`, () => {
        if (!confirming) void run({ type: 'addHistoryRoom', historyId: entry.id }, entry.id);
      }, 'history-room');
      room.dataset.historyId = entry.id; room.dataset.historyAction = 'add';
      room.title = `${label}\n房号 ${entry.platformRoomId}\n${entry.canonicalUrl}`;
      room.disabled = !ready || busy || confirming;
      room.append(element('span', 'history-label', label), element('span', 'history-address', `房号 ${entry.platformRoomId} · ${entry.canonicalUrl}`));
      const remove = button('删除', `从历史中删除 ${label}，保留当前房间和组合`, () => {
        if (!confirming) void run({ type: 'removeHistoryRoom', historyId: entry.id }, entry.id);
      }, 'history-remove');
      remove.dataset.historyId = entry.id; remove.dataset.historyAction = 'remove';
      remove.disabled = !ready || busy || confirming;
      row.append(room, remove); return row;
    });
    list.replaceChildren(...nodes);
    empty.hidden = !ready || page.total > 0;
    empty.textContent = search.value.trim() ? '没有匹配的历史记录。试试平台名、主播昵称或房号。' : '还没有历史记录。成功添加的直播间会保存在这里。';
    more.hidden = page.entries.length >= page.total;
    more.disabled = busy || confirming;
    more.textContent = `显示更多（已显示 ${page.entries.length} / ${page.total}）`;
    if (pendingFocus && !busy && (active || document.activeElement === document.body)) {
      const replacement = [...list.querySelectorAll<HTMLButtonElement>('button')].find(node => node.dataset.historyId === pendingFocus?.id && node.dataset.historyAction === pendingFocus?.action && !node.disabled);
      (replacement ?? list.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? search).focus({ preventScroll: true });
      pendingFocus = undefined;
    }
  }
  return {
    element: panel,
    toggle() { void setOpen(!open); },
    update(next: AppState) {
      current = next;
      const wasOpen = open;
      open = next.historyOpen === true;
      panel.hidden = !open;
      if (!open && wasOpen) { confirming = false; localError = ''; pendingFocus = undefined; metadataSignature='';restoreFocus(); }
      renderContent();
      if (open && !wasOpen) search.focus({ preventScroll: true });
    },
    dispose() { disposed = true; document.removeEventListener('keydown', onKeydown); },
  };
}
