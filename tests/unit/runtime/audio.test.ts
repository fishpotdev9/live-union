import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioPolicy } from '../../../src/main/audio/policy.ts';

test('new and restored rooms mute before readiness; solo mutes others first and maps are copies',()=>{
  const policy=new AudioPolicy();const calls:string[]=[];
  const contents=(id:string)=>({isDestroyed:()=>false,setAudioMuted:(muted:boolean)=>calls.push(`${id}:${muted}`)});
  policy.add('a',contents('a'),true);policy.add('b',contents('b'));
  assert.deepEqual(calls,['a:true','b:true']);
  policy.ready('a');policy.ready('b');calls.length=0;
  policy.apply({kind:'solo',roomId:'b'});
  assert.deepEqual(calls,['a:true','b:false']);
  const snapshot=policy.snapshot() as Map<string,boolean>;snapshot.set('a',true);
  assert.equal(policy.snapshot().get('a'),false);
  policy.apply({kind:'set',roomId:'a',allowed:true});
  assert.deepEqual([...policy.snapshot().values()],[true,true]);
  policy.loading('b');assert.equal(calls.at(-1),'b:true');
  policy.ready('b');assert.equal(calls.at(-1),'b:false');
  policy.remove('b');assert.equal(policy.snapshot().get('a'),true);
  policy.apply({kind:'solo',roomId:'missing'});assert.equal(policy.snapshot().get('a'),false);
});

test('reentrant newer intent prevents stale solo from opening its target',()=>{
  const policy=new AudioPolicy();let interrupt=false;const calls:string[]=[];
  policy.add('a',{isDestroyed:()=>false,setAudioMuted(muted){calls.push(`a:${muted}`);if(interrupt&&muted){interrupt=false;policy.apply({kind:'muteAll'});}}});
  policy.add('b',{isDestroyed:()=>false,setAudioMuted:muted=>{calls.push(`b:${muted}`);}});
  policy.ready('a');policy.ready('b');calls.length=0;interrupt=true;
  policy.apply({kind:'solo',roomId:'b'});
  assert.ok(!calls.includes('b:false'));assert.deepEqual([...policy.snapshot().values()],[false,false]);
});

test('muting exceptions never allow a second source; destroyed handles are harmless',()=>{
  const policy=new AudioPolicy();let fail=false,destroyed=false;const calls:boolean[]=[];
  policy.add('a',{isDestroyed:()=>destroyed,setAudioMuted(){if(fail)throw new Error('native failure');}});
  policy.add('b',{isDestroyed:()=>false,setAudioMuted:muted=>{calls.push(muted);}});
  policy.ready('a');policy.ready('b');calls.length=0;fail=true;
  assert.doesNotThrow(()=>policy.apply({kind:'solo',roomId:'b'}));assert.ok(!calls.includes(false));
  destroyed=true;policy.apply({kind:'solo',roomId:'b'});assert.equal(calls.at(-1),false);
  assert.doesNotThrow(()=>policy.remove('a'));
});
