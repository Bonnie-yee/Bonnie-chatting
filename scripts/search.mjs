import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalize } from './corpus.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageAliases = { '刚加好友': 'new', '加好友': 'new', '认识一段时间': 'familiar', '加了一段时间后': 'familiar', '即将在一起': 'close' };
const stageNames = { new: '刚加好友', familiar: '认识一段时间', close: '即将在一起' };

function grams(text) {
  const words = normalize(text).toLowerCase().match(/[\p{Script=Han}a-z0-9]+/gu) ?? [];
  const tokens = new Set();
  for (const word of words) {
    const chars = [...word];
    if (chars.length === 1) tokens.add(word);
    for (let i = 0; i + 1 < chars.length; i++) tokens.add(chars[i] + chars[i + 1]);
  }
  return tokens;
}

function overlap(query, document, weights) {
  let numerator = 0, queryWeight = 0, documentWeight = 0;
  for (const token of query) queryWeight += weights.get(token) ?? 1;
  for (const token of document) documentWeight += weights.get(token) ?? 1;
  for (const token of query) if (document.has(token)) numerator += weights.get(token) ?? 1;
  return numerator / Math.max(1, Math.sqrt(queryWeight * documentWeight));
}

export function forbiddenThirdPartyClaim(text) {
  return /准备[^。\n]{0,25}(?:部门|同事|留子)[^。\n]{0,20}(?:对象|男朋友)|帅哥[^。\n]{0,15}(?:帮我|封网)|(?:找|介绍|认识)[^。\n]{0,10}帅哥|哥哥们|几个哥哥|全是年上/.test(text);
}

function inferredMinimumStage(text) {
  if (/牵手|地下恋|占有欲|关键情节|一心只有|惦记奖励/.test(text)) return 'close';
  if (/报备|crush|想我|想你|哥哥|妹妹|仅你可见|奖励/.test(text)) return 'familiar';
  return 'new';
}

function invitationState(query, availability, suppliedState) {
  const valid = ['need_invitation', 'need_date', 'need_time', 'offer_availability', 'confirm'];
  if (suppliedState) {
    if (!valid.includes(suppliedState)) throw new Error('Unknown invitation state');
    return suppliedState;
  }
  if (/还(?:没有|没)(?:主动)?(?:提出|提过|说过)?(?:邀约|邀请|约我|要带我)|尚未(?:邀约|邀请)|还没说(?:要)?带我/.test(query)) return 'need_invitation';
  if (/(还没|还没有|未|没定|没有确定)[^。\n]{0,15}(几点|钟点)/.test(query)) return 'need_time';
  if (availability.length && /哪天|有空|时间窗口|选|挑/.test(query)) return 'offer_availability';
  if (/改天|下次有空|具体哪天|定具体时间|确定哪天/.test(query)) return 'need_date';
  return 'need_invitation';
}

export async function loadLibrary(directory = path.join(root, 'data/private')) {
  const [cases, turns, stats, exclusions, goals] = await Promise.all([
    fs.readFile(path.join(directory, 'annotated_cases.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(directory, 'reply_turns.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(directory, 'stats.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'config/exclusions.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(root, 'config/goals.json'), 'utf8').then(JSON.parse)
  ]);
  return { cases, turns, stats, exclusions, goals };
}

export function retrieveCandidates(library, { query, stage = 'familiar', emotion = 'unknown', limit = 5, includeUnreviewed = true, goal = null, availability = [], bookingState = null }) {
  stage = stageAliases[stage] ?? stage;
  if (!stageNames[stage]) throw new Error('Stage must be new, familiar, close, or its Chinese label');
  if (!['unknown', 'playful', 'warm', 'unhappy'].includes(emotion)) throw new Error('Unknown emotion mode');
  if (!query?.trim()) throw new Error('A nonempty conversation query is required');
  if (goal && !library.goals[goal]) throw new Error('Unknown reply goal');
  const currentBookingState = goal === 'concrete_invitation' ? invitationState(query, availability, bookingState) : null;
  const bookingSteps = {
    need_invitation: ['opening', 'ordinary_topic_bridge'],
    need_date: ['request_date'],
    need_time: ['request_time'],
    offer_availability: ['offer_real_availability', 'let_him_choose'],
    confirm: ['confirm_date', 'confirm_time']
  };
  if (emotion === 'unknown' && /生气|不高兴|争执|吵架|不真诚|不信任|不回答只提问|别再这样|玩笑还是/.test(query)) {
    return { status: 'clarify_emotion', stage: stageNames[stage], emotion, goal: goal ? { key: goal, ...library.goals[goal] } : null, booking_state: currentBookingState, user_provided_availability: availability, clarification: '这里是在互相开玩笑，还是有人真的不高兴？确认后再选择斗嘴或温和回应。', candidates: [] };
  }
  const excluded = index => library.exclusions.source_index_ranges.some(range => index >= range.start && index <= range.end);
  const pool = library.cases.map(example => ({ ...example, annotated: true }));
  if (includeUnreviewed) {
    const ranks = { new: 0, familiar: 1, close: 2 };
    for (const turn of library.turns) {
      if (turn.direct_reuse_blocked || turn.source_indices.some(excluded) || turn.reply.some(forbiddenThirdPartyClaim)) continue;
      if (ranks[inferredMinimumStage(turn.reply.join(' '))] > ranks[stage]) continue;
      pool.push({ ...turn, preferred: turn.preferred_source_indices.length > 0, annotated: false, scene: '', retrieval_hints: [], review_status: 'needs_current_scene_review', mode: 'unreviewed' });
    }
  }
  const valid = pool.filter(candidate => {
    if (candidate.source_indices.some(excluded) || candidate.reply.some(forbiddenThirdPartyClaim)) return false;
    if (goal && !candidate.supported_goals?.includes(goal)) return false;
    if (currentBookingState === 'need_invitation' && !candidate.booking_step) return false;
    if (currentBookingState && candidate.booking_step && !bookingSteps[currentBookingState].includes(candidate.booking_step)) return false;
    if (currentBookingState === 'need_date' && !candidate.booking_step) return false;
    if (currentBookingState === 'need_time' && !candidate.booking_step) return false;
    if (candidate.allowed_stages && !candidate.allowed_stages.includes(stage)) return false;
    if (['warm', 'unhappy'].includes(emotion) && candidate.mode !== 'warm') return false;
    return true;
  });
  const inputs = valid.map(candidate => {
    const before = [...(candidate.context_before ?? []), ...(candidate.addressed_messages ?? [])].map(row => row.text).join(' ');
    return { candidate, context: grams(before), intent: grams([candidate.scene, ...(candidate.retrieval_hints ?? [])].join(' ')), reply: grams(candidate.reply.join(' ')) };
  });
  const frequencies = new Map();
  for (const input of inputs) {
    for (const token of new Set([...input.context, ...input.intent])) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  const weights = new Map([...frequencies].map(([token, frequency]) => [token, 1 + Math.log((inputs.length + 1) / (frequency + 1))]));
  const q = grams(query);
  const normalizedQuery = normalize(query);
  const scored = inputs.map(input => {
    const hints = input.candidate.retrieval_hints.filter(hint => normalizedQuery.includes(normalize(hint)));
    const hintScore = Math.min(4, hints.reduce((sum, hint) => sum + 0.5 + Math.min(1.5, [...hint].length / 4), 0));
    const contextScore = overlap(q, input.context, weights);
    const intentScore = overlap(q, input.intent, weights);
    const replyScore = overlap(q, input.reply, weights);
    const score = (contextScore * 2 + intentScore * 1.2 + replyScore * 0.12 + hintScore) * (input.candidate.preferred ? 1.06 : 1);
    return { ...input.candidate, score, matched_hints: hints, context_score: contextScore };
  }).filter(candidate => candidate.annotated
    ? candidate.score >= 0.45 && (candidate.matched_hints.length > 0 || candidate.context_score >= 0.18)
    : candidate.score >= 0.55 && candidate.context_score >= 0.2
  ).sort((a, b) => b.score - a.score || Number(b.annotated) - Number(a.annotated));
  const accepted = [];
  for (const candidate of scored) {
    if (candidate.score < Math.max(0.55, (scored[0]?.score ?? 0) * 0.35)) continue;
    if (accepted.some(chosen => candidate.source_indices.some(index => chosen.source_indices.includes(index)))) continue;
    accepted.push(candidate);
    if (accepted.length >= Math.max(1, Math.min(20, limit))) break;
  }
  return {
    status: accepted.length ? 'candidates_for_context_review' : 'no_close_match',
    stage: stageNames[stage],
    emotion,
    goal: goal ? { key: goal, ...library.goals[goal] } : null,
    booking_state: currentBookingState,
    user_provided_availability: availability,
    ranking_method: 'Local Chinese character-bigram and curated scene-hint retrieval. Scores do not establish suitability.',
    candidates: accepted.map(candidate => ({
      id: candidate.id, source_indices: candidate.source_indices, source_type: 'original', date: candidate.date,
      reply: candidate.reply, preferred: candidate.preferred, scene: candidate.scene || null,
      condition: candidate.condition || '未逐场景标注，先结合当前上下文确认适合程度。',
      inferred_subtext: candidate.inferred_subtext || null,
      reviewed: candidate.annotated, score: Number(candidate.score.toFixed(4)), matched_hints: candidate.matched_hints,
      booking_step: candidate.booking_step ?? null,
      reuse_checks: candidate.reuse_checks ?? [],
      context_before: candidate.context_before,
      addressed_messages: candidate.addressed_messages,
      continuation_after: candidate.continuation_after
    }))
  };
}

export async function makePrompt(result, currentConversation) {
  const policy = await fs.readFile(path.join(root, 'config/system_prompt.md'), 'utf8');
  // Future messages from the source conversation are deliberately omitted.
  const examples = result.candidates.map(candidate => ({id:candidate.id,writer:'我',source_type:'original_user',my_messages:candidate.reply,scene_summary:candidate.scene,usage_condition:candidate.condition}));
  return `${policy}\n\n当前阶段：${result.stage}\n当前情绪：${result.emotion ?? '待核对'}\n当前目标：${JSON.stringify(result.goal ?? '自然接话')}\n邀约推进状态：${result.booking_state ?? '不适用或待核对'}\n用户提供的真实空闲时间：${JSON.stringify(result.user_provided_availability ?? [])}\n当前对话：\n${currentConversation}\n\n检索状态：${result.status}\n本人候选原话及使用条件（不含ta的原句，条件描述不是待发回复）：\n${JSON.stringify(examples, null, 2)}\n\n请先判断样本是否适配当前情境，再按原句、最小改写、模仿的顺序选择。需要确认情绪或事实时先核对。`;
}

async function main() {
  const args = process.argv.slice(2);
  const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const query = value('--query');
  const result = retrieveCandidates(await loadLibrary(), {
    query, stage: value('--stage') ?? 'familiar', emotion: value('--emotion') ?? 'unknown',
    limit: Number(value('--limit') ?? 5), includeUnreviewed: !args.includes('--reviewed-only'),
    goal: value('--goal') ?? null, availability: value('--availability')?.split(',').map(text => text.trim()).filter(Boolean) ?? [],
    bookingState: value('--booking-state') ?? null
  });
  if (args.includes('--prompt')) process.stdout.write(await makePrompt(result, query));
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (typeof process !== 'undefined' && process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
