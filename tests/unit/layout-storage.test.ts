import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { computeLayout, toNormalized } from '../../src/domain/layout/index.ts';
import { WorkspaceRepository } from '../../src/main/storage/index.ts';
import type { PlatformId, WorkspaceSnapshot } from '../../src/shared/contracts.ts';

test('layout v1 geometry survives workspace persistence for every count 0..9 and both templates',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'live-union-cross-'));
  t.after(async()=>{
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())+sep));
    assert.ok(basename(directory).startsWith('live-union-cross-'));
    await rm(directory,{recursive:true,force:true});
  });
  const repo=new WorkspaceRepository(directory);
  for(let count=0;count<=9;count++)for(const template of ['equal','focus'] as const){
    const canvas={width:2195,height:1080};
    const rooms=Array.from({length:count},(_,i)=>{
      const platform:PlatformId=(['huya','douyu','bilibili'] as const)[i%3];
      const host={huya:'www.huya.com',douyu:'www.douyu.com',bilibili:'live.bilibili.com'}[platform];
      return {id:randomUUID(),platform,platformRoomId:String(100+i),canonicalUrl:`https://${host}/${100+i}`,
        chat:{visible:i%2===0,preferredWidthDip:260},audio:{allowed:i===0||i===2}};
    });
    const order=rooms.map(r=>r.id),chat=Object.fromEntries(rooms.map(r=>[r.id,r.chat]));
    const geometry=computeLayout({canvas,roomIds:order,template,chat,primaryRoomId:order.at(-1)});
    const rects=Object.fromEntries(order.map(id=>[id,toNormalized(geometry.rooms[id].outer,canvas,geometry.rooms[id].z)]));
    const snapshot:WorkspaceSnapshot={schemaVersion:1,id:randomUUID(),name:`${count} rooms ${template}`,rooms,stableOrder:order,
      layout:{base:template,editing:'free',...(order.length?{primaryRoomId:order.at(-1)}:{}),equal:{variant:'balanced',order:[...order]},
        focus:{variant:'auto',order:[...order]},free:{from:template,rects}}};
    await repo.save(snapshot);
    const restored=await new WorkspaceRepository(directory).load();
    assert.deepEqual(restored.snapshot,snapshot);
    const layout=computeLayout({canvas:{width:960,height:640},roomIds:restored.snapshot!.stableOrder,template:'free',chat,
      freeRects:restored.snapshot!.layout.free.rects});
    assert.deepEqual(layout.order,order);
    for(const id of order){
      const r=layout.rooms[id].outer;
      assert.ok(Number.isFinite(r.x)&&Number.isFinite(r.y));
      assert.ok(r.width>0&&r.height>0);
      assert.ok(r.y>=0&&r.y+Math.min(32,r.height)<=640);
    }
    assert.deepEqual(restored.snapshot!.rooms.map(r=>r.audio),rooms.map(r=>r.audio));
    assert.deepEqual(restored.snapshot!.rooms.map(r=>r.chat),rooms.map(r=>r.chat));
  }
});
