import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTurns } from '../scripts/corpus.mjs';
import { loadLibrary, retrieveCandidates, makePrompt } from '../scripts/search.mjs';

const library = await loadLibrary();
const allExcluded = index => library.exclusions.source_index_ranges.some(range => index >= range.start && index <= range.end);

test('source completeness and all own messages are accounted for', () => {
  assert.equal(library.stats.source_record_count, 2459);
  assert.equal(library.stats.own_message_count, 1138);
  assert.equal(library.stats.eligible_own_message_count + library.stats.excluded_own_message_count, 1138);
  assert.equal(library.turns.flatMap(turn => turn.source_indices).length, 1068);
  assert.equal(new Set(library.turns.flatMap(turn => turn.source_indices)).size, 1068);
  assert.equal(library.stats.source_verified_against_docx, true);
});

test('preference duplicates never gain repeated ranking weight', () => {
  assert.equal(library.stats.preferred_appearances, 428);
  assert.equal(library.stats.preferred_unique_messages, 389);
  assert.equal(library.stats.duplicate_preference_appearances, 39);
  assert.equal(new Set(library.turns.flatMap(turn => turn.preferred_source_indices)).size, 389);
});

test('all forbidden ranges stay out of targets, contexts and annotation sources', () => {
  for (const sample of [...library.turns, ...library.cases]) {
    assert.ok(sample.source_indices.every(index => !allExcluded(index)));
    for (const row of [...sample.context_before, ...sample.continuation_after]) assert.ok(!allExcluded(row.source_index));
    for (const text of sample.reply) assert.ok(!text.includes('准备在部门里找个留子当对象'));
    for (const text of sample.reply) assert.ok(!text.includes('都是帅哥帮我封网'));
  }
});

test('user-confirmed playful exchanges remain available', () => {
  const sources = new Set(library.turns.flatMap(turn => turn.source_indices));
  for (const index of [1392, 1400, 1401, 2330, 2331]) assert.ok(sources.has(index));
  assert.ok(library.cases.find(example => example.id === 'playful_ball').emotion_confirmed_by_user);
});

test('context grouping never joins replies across an excluded scene', () => {
  const rows = [
    { index: 1, sender: '我', timestamp: 100 },
    { index: 2, sender: '我', timestamp: 101 },
    { index: 3, sender: '我', timestamp: 102 }
  ];
  assert.deepEqual(buildTurns(rows, 120, row => row.index === 2).map(turn => turn.records.map(row => row.index)), [[1], [3]]);
});

test('early stage cannot retrieve annotated intimate future-scene replies', () => {
  const result = retrieveCandidates(library, { query: '梦里约会关键情节被打断了，现实中能续上吗', stage: 'new' });
  assert.ok(!result.candidates.some(candidate => candidate.id === 'dream_continuation'));
  assert.ok(!result.candidates.some(candidate => candidate.source_indices.includes(2458)));
});

test('uncertain anger asks for clarification before playful candidates', () => {
  const result = retrieveCandidates(library, { query: '他说我不真诚，我不确定他是不是生气了', stage: 'familiar' });
  assert.equal(result.status, 'clarify_emotion');
  assert.deepEqual(result.candidates, []);
});

test('real unhappiness routes to warm positive examples', () => {
  const result = retrieveCandidates(library, { query: '他想认真交换自己的想法，希望我理解', stage: 'familiar', emotion: 'unhappy' });
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(candidate => library.cases.find(example => example.id === candidate.id)?.mode === 'warm'));
});

test('source future responses do not enter the assistant prompt or influence scores', async () => {
  const options = { query: '他说今天好累，电量只剩一点了', stage: 'new' };
  const result = retrieveCandidates(library, options);
  const mutated = { ...library, cases: library.cases.map(example => ({ ...example, continuation_after: [{ source_index: 99999, text: 'FUTURE_SECRET_SHOULD_NOT_APPEAR' }] })) };
  assert.deepEqual(retrieveCandidates(mutated, options).candidates.map(candidate => [candidate.id, candidate.score]), result.candidates.map(candidate => [candidate.id, candidate.score]));
  const prompt = await makePrompt(retrieveCandidates(mutated, options), options.query);
  assert.ok(!prompt.includes('FUTURE_SECRET_SHOULD_NOT_APPEAR'));
});

test('annotated original replies really occur as own speech, not quoted ta speech', () => {
  const allTargets = new Map();
  for (const turn of library.turns) turn.source_indices.forEach((index, i) => allTargets.set(index, turn.reply[i]));
  for (const example of library.cases) example.source_indices.forEach((index, i) => assert.equal(example.reply[i], allTargets.get(index)));
});

test('invitation goal only retrieves candidates that can advance that goal', () => {
  const result = retrieveCandidates(library, { query: '他说下次有空一起吃饭，我想引导他主动定具体时间', stage: 'familiar', goal: 'concrete_invitation' });
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(candidate => library.cases.find(example => example.id === candidate.id)?.supported_goals?.includes('concrete_invitation')));
  assert.equal(result.goal.key, 'concrete_invitation');
  assert.deepEqual(result.user_provided_availability, []);
});

test('only current user availability enters the availability field, not source dates', async () => {
  const options = { query: '他问我哪天有空，想见面', stage: 'familiar', goal: 'concrete_invitation', availability: ['周日下午四点以后'] };
  const result = retrieveCandidates(library, options);
  assert.deepEqual(result.user_provided_availability, ['周日下午四点以后']);
  const prompt = await makePrompt(result, options.query);
  assert.ok(prompt.includes('用户提供的真实空闲时间：["周日下午四点以后"]'));
  assert.ok(prompt.includes('旧样本里的周三、周五、生日月、下下周或档期排满，都不是当前可用事实'));
});

test('pending emotion clarification preserves the invitation goal and availability', () => {
  const result = retrieveCandidates(library, { query: '不确定他是不是生气了，我想让他约我', stage: 'familiar', goal: 'concrete_invitation', availability: ['周六下午'] });
  assert.equal(result.status, 'clarify_emotion');
  assert.equal(result.goal.key, 'concrete_invitation');
  assert.deepEqual(result.user_provided_availability, ['周六下午']);
});

test('vague invitation asks him for a date rather than copying an old Friday', () => {
  const result = retrieveCandidates(library, { query: '他说下次有空一起吃饭，我想让他主动定具体哪天', stage: 'familiar', goal: 'concrete_invitation' });
  assert.equal(result.booking_state, 'need_date');
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(candidate => candidate.booking_step === 'request_date'));
  assert.ok(!result.candidates.some(candidate => candidate.id === 'confirm_evening'));
});

test('once date is known the next retrieved move asks only for clock time', () => {
  const result = retrieveCandidates(library, { query: '我们已经确定周六见面，还没有确定几点', stage: 'familiar', goal: 'concrete_invitation' });
  assert.equal(result.booking_state, 'need_time');
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(candidate => candidate.booking_step === 'request_time'));
});

test('ordinary food sharing without an invitation retrieves a bridge, not a date demand', () => {
  const result = retrieveCandidates(library, { query: '他只是分享美食，说这家店好吃，还没有提出邀约，我想让他主动约我吃饭', stage: 'familiar', goal: 'concrete_invitation' });
  assert.equal(result.booking_state, 'need_invitation');
  assert.ok(result.candidates.length > 0);
  assert.ok(result.candidates.every(candidate => ['opening', 'ordinary_topic_bridge'].includes(candidate.booking_step)));
  assert.ok(!result.candidates.some(candidate => ['request_date', 'confirm_date', 'request_time'].includes(candidate.booking_step)));
});

test('an uninvited scene keeps the invitation step even when the user eventually wants a concrete time', () => {
  const result = retrieveCandidates(library, { query: '他还没主动约我，我想从普通聊天引导邀约，最后定具体时间', stage: 'familiar', goal: 'concrete_invitation' });
  assert.equal(result.booking_state, 'need_invitation');
});
