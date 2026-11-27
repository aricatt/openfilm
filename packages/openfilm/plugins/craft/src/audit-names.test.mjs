import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atName, commentName, ownName, exposedNames } from './audit-names.mjs';
import { coversOf, readAuditAnswer } from './audit.mjs';

test('atName finds @names, not counts', () => {
  assert.equal(atName('@小明 你好').name, '@小明');
  assert.equal(atName('@38.3万 播放'), null);
});

test('commentName finds chinese nicknames before colons', () => {
  assert.equal(commentName('何瑞成：说得好').name, '何瑞成');
  assert.equal(commentName('时间：10点'), null, 'a label is no name');
  assert.equal(commentName('02:23 时间戳'), null, 'a time is no name');
  assert.equal(commentName('hello: world'), null, 'no CJK no name');
});

test('commentName finds ellipsis-cut names', () => {
  assert.equal(commentName('闪机侠二手机电脑…').name, '闪机侠二手机电脑');
});

test('ownName matches fuzzily', () => {
  assert.equal(ownName('@阿杜Next', ['阿杜']), '阿杜');
  assert.equal(ownName('何瑞成', ['阿杜']), null);
});

test('exposedNames: others yes, ours no', () => {
  assert.equal(exposedNames('何瑞成：说得好').length, 1);
  assert.equal(exposedNames('何瑞成：说得好', ['何瑞成']).length, 0);
});

test('coversOf pads the box a little', () => {
  const covers = coversOf([{ s: '何瑞成：说得好', box: [0.1, 0.1, 0.3, 0.05] }]);
  assert.equal(covers.length, 1);
  assert.ok(covers[0].h > 0.05);
  assert.ok(covers[0].x < 0.1);
});

test('readAuditAnswer validates hard', () => {
  assert.deepEqual(readAuditAnswer('[]'), []);
  assert.equal(readAuditAnswer('not json'), null);
  assert.equal(readAuditAnswer('[{"s":"x","box":[0,0,0.5,0.5]}]').length, 1);
  assert.equal(readAuditAnswer('[{"s":"x","box":[0,0,5,5]}]').length, 0, 'out of range dropped');
});
