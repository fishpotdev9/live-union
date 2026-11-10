import type { AppCommand, AppState, CommandResult, LiveUnionBridge } from '../../shared/app-contracts.ts';

declare global { interface Window { liveUnion: LiveUnionBridge } }

/** Only gesture messages share a queue; network work cannot delay independent controls. */
export function commandQueue(bridge: LiveUnionBridge, report: (message: string) => void) {
  let tail: Promise<unknown> = Promise.resolve();
  const invoke = async (command: AppCommand): Promise<CommandResult | undefined> => {
    try {
      const result = await bridge.command(command);
      if (!result.ok) report(result.error);
      return result;
    } catch {
      report('操作未完成，请重试。');
      return undefined;
    }
  };
  return (command: AppCommand): Promise<CommandResult | undefined> => {
    if (!['geometryBegin', 'geometryDelta', 'geometryEnd'].includes(command.type)) return invoke(command);
    const next = tail.then(() => invoke(command));
    tail = next;
    return next;
  };
}

export function connectState(
  bridge: LiveUnionBridge,
  render: (state: AppState) => void,
  report: (message: string) => void,
) {
  let disposed = false;
  let revision = -1;
  const send = commandQueue(bridge, message => { if (!disposed) report(message); });
  // Subscribe first: getState responds through the same state event stream.
  const unsubscribe = bridge.onState(state => {
    if (disposed || state.revision < revision) return;
    revision = state.revision;
    render(state);
  });
  void send({ type: 'getState' });
  return { send, dispose() { disposed = true; unsubscribe(); } };
}
