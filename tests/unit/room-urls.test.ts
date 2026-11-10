import test from 'node:test';import assert from 'node:assert/strict';
import { normalizeRoomUrl } from '../../src/platforms/shared/urls.ts';
test('three platform URLs normalize tracking, bare domain and B room paths',()=>{
  assert.equal(normalizeRoomUrl('https://huya.com/222523/?from=share#player').canonicalUrl,'https://www.huya.com/222523');
  assert.equal(normalizeRoomUrl('https://douyu.com/0009999?x=1').platformRoomId,'9999');
  assert.equal(normalizeRoomUrl('https://live.bilibili.com/blanc/6?x=1').canonicalUrl,'https://live.bilibili.com/6');
  assert.equal(normalizeRoomUrl('https://www.huya.com/wuhushenkp').platformRoomId,'wuhushenkp');
});
test('lookalike hosts, credentials, unsupported schemes and non-room paths cannot enter runtime',()=>{
  for(const url of ['https://www.huya.com.evil.test/1','https://www.huya.com@evil.test/1','https://user:secret@www.huya.com/1','http://www.douyu.com/1','file:///tmp/a','javascript:alert(1)','https://live.bilibili.com/','https://www.huya.com/g/lol','https://www.huya.com/download','https://www.douyu.com/g_LOL','https://www.huya.com/1:2','https://www.douyu.com:444/1','https://live.bilibili.com/0'])assert.throws(()=>normalizeRoomUrl(url));
});
