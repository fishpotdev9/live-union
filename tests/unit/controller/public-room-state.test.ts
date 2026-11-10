import test from 'node:test';
import assert from 'node:assert/strict';
import { douyuLiveState } from '../../../src/main/bootstrap/public-room-state.ts';

test('public Douyu status distinguishes live and ended streams without treating HTML readiness as playback',()=>{
  for(const status of [1,'1'])assert.equal(douyuLiveState({room:{show_status:status}}),'live');
  for(const status of [2,'2'])assert.equal(douyuLiveState({room:{show_status:status}}),'offline');
  for(const raw of [null,[],{},{room:null},{room:[]},{room:{show_status:0}},{room:{show_status:true}},{room:{show_status:'private-token',chat:'private-chat'}}])assert.equal(douyuLiveState(raw),'unknown');
});
