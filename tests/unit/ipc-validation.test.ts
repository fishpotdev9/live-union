import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateCommand } from '../../src/main/ipc/validation.ts';
test('a room chrome cannot control another room or global workspace operations',()=>{
  const id=randomUUID(),other=randomUUID();
  assert.deepEqual(validateCommand({type:'soloAudio',roomId:id},{role:'room',roomId:id}),{type:'soloAudio',roomId:id});
  assert.throws(()=>validateCommand({type:'removeRoom',roomId:other},{role:'room',roomId:id}));
  assert.throws(()=>validateCommand({type:'muteAll'},{role:'room',roomId:id}));
  assert.throws(()=>validateCommand({type:'openWorkspace',workspaceId:id},{role:'room',roomId:id}));
});
test('malformed geometry, invented commands and extra capabilities are rejected',()=>{
  for(const bad of [NaN,Infinity,-Infinity,100001,'12'])assert.throws(()=>validateCommand({type:'geometryDelta',roomId:randomUUID(),gestureId:randomUUID(),dx:bad,dy:0},{role:'toolbar'}));
  assert.throws(()=>validateCommand({type:'executeJavaScript',code:'anything'},{role:'toolbar'}));
  assert.throws(()=>validateCommand({type:'getState',path:'private'},{role:'toolbar'}));
  assert.throws(()=>validateCommand({type:'addRoom',url:'x'.repeat(2049)},{role:'toolbar'}));
});
test('valid toolbar commands retain only exact contract fields',()=>{
  const roomId=randomUUID(),gestureId=randomUUID();
  const command={type:'geometryDelta',roomId,gestureId,dx:-80.5,dy:10};
  assert.deepEqual(validateCommand(command,{role:'toolbar'}),command);
  assert.deepEqual(validateCommand({type:'setAllChat',visible:false},{role:'toolbar'}),{type:'setAllChat',visible:false});
});

test('global history is toolbar-only and metadata batches cannot expand capabilities',()=>{
  const id=randomUUID();
  const commands=[{type:'addHistoryRoom',historyId:id},{type:'removeHistoryRoom',historyId:id},{type:'clearHistory'},{type:'setHistoryOpen',open:true},{type:'refreshHistoryMetadata',historyIds:[id]}];
  for(const command of commands){assert.deepEqual(validateCommand(command,{role:'toolbar'}),command);assert.throws(()=>validateCommand(command,{role:'room',roomId:id}));}
  for(const ids of [[id,id],Array.from({length:41},()=>randomUUID()),['not-a-history-id']])assert.throws(()=>validateCommand({type:'refreshHistoryMetadata',historyIds:ids},{role:'toolbar'}));
  assert.throws(()=>validateCommand({type:'removeHistoryRoom',historyId:id,deleteWorkspace:true},{role:'toolbar'}));
});
