const id = new URLSearchParams(location.search).get('id');
let state;
const send = async (action, data = {}) => {
  const result = await window.g0.command({ action, id, ...data });
  if (!result.ok && document.querySelector('#message')) document.querySelector('#message').textContent = result.error;
  return result;
};
document.querySelector('#add')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await send('add', { url: document.querySelector('#url').value });
  if (result.ok) document.querySelector('#url').value = '';
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) send(button.dataset.action);
});
for (const [selector, action] of [['#drag', 'move'], ['#resize', 'resize']]) {
  const handle = document.querySelector(selector);
  handle?.addEventListener('pointerdown', async (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    handle.setPointerCapture(event.pointerId);
    const start = { x: event.screenX, y: event.screenY };
    await send('beginGeometry');
    const move = (next) => send(action, { dx: next.screenX - start.x, dy: next.screenY - start.y });
    const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); send('endGeometry'); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end, { once: true });
  });
}
window.g0.onState((value) => {
  state = value;
  if (id) {
    const room = value.rooms.find((item) => item.id === id);
    if (!room) return;
    document.querySelector('#label').textContent = room.label;
    document.querySelector('#status').textContent = `${room.navigation} · #${room.webContentsId}`;
    document.querySelector('[data-action="allow"]').textContent = room.allowed ? '静音' : '开声';
    document.querySelector('[data-action="native"]').textContent = value.expanded === id ? '还原' : '放大原网页';
  } else {
    document.querySelector('#env').textContent = `Electron ${value.electron} · ${value.display.width}×${value.display.height} DIP · ${value.display.scaleFactor * 100}%`;
    document.querySelector('#message').textContent = `${value.rooms.length} 个真实运行实例 · 拖标题移动，拖底边缩放 · 无自动发送`;
  }
});
send('state');
