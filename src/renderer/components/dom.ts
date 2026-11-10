export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export function button(text: string, label: string, action: () => void, className = '') {
  const node = element('button', className, text);
  node.type = 'button';
  node.title = label;
  node.setAttribute('aria-label', label);
  node.addEventListener('click', action);
  return node;
}

export function pressed(node: HTMLButtonElement, value: boolean) {
  node.setAttribute('aria-pressed', String(value));
}

export function renameButton(node: HTMLButtonElement, text: string, label = text) {
  node.textContent = text;
  node.title = label;
  node.setAttribute('aria-label', label);
}
