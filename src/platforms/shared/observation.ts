import type { OperationResult } from '../../shared/app-contracts.ts';
const statuses=new Set(['applied','restored','unsupported','notReady','failed']);
const extraReasons=['document-not-ready','player-structure','player-not-ready','chat-structure','page-hidden','space','layout','chat-layout'];
const reasons=new Set(['structure','style-collision','input-not-ready','chat-too-narrow','space-or-layout','layout-error','native-structure','native-send-geometry','chat-ancestry','native-scroll-geometry','player-depth','native-geometry','structure-changed','insufficient-space','insufficient-chat-space','candidate-layout','native-fullscreen','probe-error','not-applied','native-page','invalid-preferences','restore-failed','room-document-unavailable','ambiguous-room','room-missing-or-cross-origin','required-structure-missing','insufficient-control-space','chat-common-root-mismatch','presentation-rolled-back','structure-invalidated','native-overlay','controls-need-zoom','invalid-chat-width']);
for(const reason of extraReasons)reasons.add(reason);
export function operationResult(raw:unknown):OperationResult{
  const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
  return{status:typeof value.status==='string'&&statuses.has(value.status)?value.status as OperationResult['status']:'failed',reason:typeof value.reason==='string'&&reasons.has(value.reason)?value.reason:'unknown'};
}
/** Bound the structured-clone payload inside the untrusted document as well as in main. */
export const operationFilter=`value => ({status:typeof value?.status==='string'&&${JSON.stringify([...statuses])}.includes(value.status)?value.status:'failed',reason:typeof value?.reason==='string'&&${JSON.stringify([...reasons])}.includes(value.reason)?value.reason:'unknown'})`;
export const dynamicOperationScript=`(() => {const value=globalThis[Symbol.for('live-union.presentation.result')];return value?(${operationFilter})(value):null;})()`;
