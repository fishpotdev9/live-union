import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomHistoryEntry } from '../../../src/shared/history-contracts.ts';
import { historyEntryLabel } from '../../../src/shared/history-contracts.ts';
import { filterHistory, historyPage } from '../../../src/renderer/workspace/history-panel.ts';

const entries: RoomHistoryEntry[] = [
  { id: 'h', platform: 'huya', platformRoomId: '340204', canonicalUrl: 'https://www.huya.com/340204', nickname: '主播 Alpha', lastAddedAt: 300 },
  { id: 'd', platform: 'douyu', platformRoomId: '9999', canonicalUrl: 'https://www.douyu.com/9999', nickname: '主播 Beta', lastAddedAt: 200 },
  { id: 'b', platform: 'bilibili', platformRoomId: '7734200', canonicalUrl: 'https://live.bilibili.com/7734200', lastAddedAt: null },
];

test('history search matches platform names, Bilibili aliases, nickname, ID and URL', () => {
  for (const query of ['huya', '虎牙', 'ALPHA', '340204', 'https://www.huya.com/340204']) {
    assert.deepEqual(filterHistory(entries, query).map(entry => entry.id), ['h'], query);
  }
  for (const query of ['douyu', '斗鱼', 'Beta']) assert.equal(filterHistory(entries, query)[0]?.id, 'd', query);
  for (const query of ['bilibili', '哔哩哔哩', 'B站', 'Ｂ站', 'b 站', '7734200']) {
    assert.deepEqual(filterHistory(entries, query).map(entry => entry.id), ['b'], query);
  }
  assert.deepEqual(filterHistory(entries, ' 虎牙   alpha ').map(entry => entry.id), ['h']);
  assert.deepEqual(filterHistory(entries, '虎牙 beta'), []);
  assert.deepEqual(filterHistory(entries, '不存在'), []);
});

test('search preserves recent snapshot order and treats nickname text literally', () => {
  assert.deepEqual(filterHistory(entries, '主播').map(entry => entry.id), ['h', 'd']);
  assert.deepEqual(filterHistory(entries, '  ').map(entry => entry.id), ['h', 'd', 'b']);
  const literal = { ...entries[0]!, nickname: '<img src=x onerror=alert(1)>' };
  assert.equal(filterHistory([literal], '<img')[0], literal);
  assert.equal(historyEntryLabel(literal), '虎牙－<img src=x onerror=alert(1)>');
  assert.equal(historyEntryLabel(entries[2]!), 'B站－7734200');
});

test('paging searches all records and can reveal every match without mutating the snapshot', () => {
  const many = Array.from({ length: 107 }, (_, index): RoomHistoryEntry => ({
    ...entries[0]!, id: String(index), platformRoomId: String(index), nickname: index >= 80 ? '后段匹配' : '先前记录',
  }));
  const original = JSON.stringify(many);
  assert.equal(historyPage(many, '').entries.length, 40);
  assert.equal(historyPage(many, '', 80).entries.length, 80);
  assert.equal(historyPage(many, '', 120).entries.length, 107);
  const filtered = historyPage(many, '后段匹配', 10);
  assert.equal(filtered.total, 27);
  assert.deepEqual(filtered.entries.map(entry => entry.id), Array.from({ length: 10 }, (_, index) => String(index + 80)));
  assert.equal(historyPage(many, '后段匹配', 40).entries.length, 27);
  assert.deepEqual(historyPage(many, '', 0), { entries: [], total: 107 });
  assert.equal(JSON.stringify(many), original);
});
