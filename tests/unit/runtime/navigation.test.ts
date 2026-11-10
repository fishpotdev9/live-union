import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedFrame, allowedLogin, allowedNavigation, PopupPermits } from '../../../src/main/sessions/navigation.ts';

test('main navigation uses exact HTTPS hosts and rejects credentials, ports and external schemes',()=>{
  for(const url of ['https://www.huya.com/123','https://lgn.huya.com/lgn/jump/authentication.do'])assert.equal(allowedNavigation('huya',url),true);
  for(const url of ['https://www.huya.com.evil.test/123','https://www.huya.com@evil.test/123','https://user:pass@www.huya.com/123','https://www.huya.com:8443/123','http://www.huya.com/123','file:///a','javascript:alert(1)','https://passport.douyu.com/'])assert.equal(allowedNavigation('huya',url),false,url);
  assert.equal(allowedLogin('huya','https://www.huya.com/123'),false);
  assert.equal(allowedLogin('douyu','https://passport.douyu.com/member/login'),true);
});
test('frames retain HTTPS/blob HTTPS/blank/srcdoc but no file/data/script targets',()=>{
  for(const url of ['https://captcha.example/frame','blob:https://live.bilibili.com/uuid','about:blank','about:srcdoc'])assert.equal(allowedFrame(url),true,url);
  for(const url of ['blob:http://evil.test/a','blob:null/a','file:///a','data:text/html,x','javascript:alert(1)','about:config','https://user:pass@example.com/'])assert.equal(allowedFrame(url),false,url);
});
test('popup permission binds owner, expires, consumes once and revokes',()=>{
  let time=0;const permits=new PopupPermits(()=>time);
  permits.permit(1);assert.equal(permits.consume(2),false);assert.equal(permits.consume(1),true);assert.equal(permits.consume(1),false);
  permits.permit(1);time=30_000;assert.equal(permits.consume(1),false);
  permits.permit(1);permits.revoke(1);assert.equal(permits.consume(1),false);
  permits.permit(1);permits.clear();assert.equal(permits.consume(1),false);
});
