import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const normalize = text => text.normalize('NFKC').replace(/\s+/g, '').replaceAll('刘子睿', 'ta');
export const alias = value => ['刘子睿', 'Rui'].includes(value) ? 'ta' : value === 'Yee' ? '我' : value;
export const cleanName = text => text.replaceAll('刘子睿', 'ta');

function decode(text) {
  return text.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return known[entity] ?? String.fromCodePoint(entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
  });
}

export function unzip(buffer) {
  let end = buffer.length - 22;
  const minimum = Math.max(0, buffer.length - 65557);
  while (end >= minimum && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < minimum) throw new Error('Invalid DOCX ZIP');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid ZIP central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const packed = buffer.subarray(start, start + size);
    if (![0, 8].includes(method)) throw new Error('Unsupported DOCX compression');
    entries.set(name, method === 8 ? zlib.inflateRawSync(packed) : Buffer.from(packed));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export function paragraphs(buffer) {
  const document = unzip(buffer).get('word/document.xml');
  if (!document) throw new Error('DOCX document.xml missing');
  return [...document.toString().matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match, i) => {
    const xml = match[0];
    const runs = [...xml.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)].map(run => ({
      text: [...run[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(t => decode(t[1])).join(''),
      tab: /<w:tab\b/.test(run[0]),
      highlighted: /<w:highlight\b[^>]*w:val="yellow"/.test(run[0])
    }));
    return {
      paragraph: i + 1,
      style: xml.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)?.[1] ?? '',
      text: runs.map(run => run.text + (run.tab ? '\t' : '')).join(''),
      runs
    };
  });
}

export function selectedReplies(editedParagraphs, rows) {
  const lookup = new Map();
  for (const row of rows) {
    const key = normalize(row.content);
    lookup.set(key, [...(lookup.get(key) ?? []), row]);
  }
  const selected = new Map();
  const unresolved = [];
  let appearances = 0;
  for (const paragraph of editedParagraphs) {
    const text = paragraph.text.trim();
    if (!text || /^引用\s*(我|ta)[：:]/.test(text) || paragraph.style === '2') continue;
    const labelled = text.match(/^(\d{2}:\d{2}:\d{2})\t(我|ta|系统提示)\t([\s\S]*)$/);
    const body = labelled?.[3] ?? text;
    let candidates = lookup.get(normalize(body)) ?? [];
    if (labelled) candidates = candidates.filter(row => row.time === labelled[1] && alias(row.sender) === labelled[2]);
    const owners = [...new Set(candidates.map(row => alias(row.sender)))];
    const own = labelled?.[2] === '我' || (!labelled && owners.length === 1 && owners[0] === '我');
    const highlighted = paragraph.runs.filter(run => run.highlighted).map(run => run.text).join('');
    if (!own && !(highlighted && normalize(highlighted) === normalize(body))) continue;
    candidates = candidates.filter(row => row.sender === '我');
    if (candidates.length !== 1) {
      unresolved.push({ paragraph: paragraph.paragraph, candidate_count: candidates.length });
      continue;
    }
    appearances++;
    const row = candidates[0];
    selected.set(row.index, [...(selected.get(row.index) ?? []), paragraph.paragraph]);
  }
  return { selected, appearances, unresolved };
}

export function buildTurns(rows, gapSeconds = 120, excluded = () => false) {
  const turns = [];
  let current = null;
  for (const row of rows) {
    if (excluded(row)) { current = null; continue; }
    if (row.sender === '系统提示') continue;
    const previous = current;
    if (previous && previous.speaker === alias(row.sender) && row.timestamp - previous.last_timestamp <= gapSeconds) {
      previous.records.push(row);
      previous.last_timestamp = row.timestamp;
    } else {
      current = { speaker: alias(row.sender), records: [row], last_timestamp: row.timestamp };
      turns.push(current);
    }
  }
  return turns;
}

function contextText(text) {
  return cleanName(text)
    .replace(/https?:\/\/\S+/g, '[链接]')
    .replace(/\b\d{17}[\dXx]\b/g, '[身份号码]')
    .replace(/\b1[3-9]\d{9}\b/g, '[电话号码]')
    .replace(/[^\n]*?(?:街道|号楼|单元|家园|华府)[^\n]*/g, '[详细地址]');
}

function publicRecord(row) {
  return {
    source_index: row.index,
    date: row.date,
    time: row.time,
    speaker: alias(row.sender),
    text: contextText(row.content),
    quote: row.quote ? { speaker: alias(row.quote.sender), text: contextText(row.quote.content) } : null
  };
}

function reuseChecks(text) {
  const checks = [];
  if (/\d{5,}|https?:\/\/|街道|号楼|单元|账号|地址/.test(text)) checks.push('identifier_or_address');
  if (/刘总|小刘|京爷|北京人|女明星|哥哥|妹妹|年上|年下|crush|前夫/.test(text)) checks.push('relationship_specific_address');
  if (/北京|香港|深圳|广州|长沙|北海|纽约|江门|宝安|南山|福田/.test(text)) checks.push('place_or_identity');
  if (/礼物|送你|送我|牵手|上手|梦到|我朋友|我闺蜜|我爸|我妈|明天|明晚|下周|周五|周六|周日|昨天|生日|我家/.test(text)) checks.push('current_facts_required');
  return checks;
}

export async function buildCorpus({ originalDocx, editedDocx, recordsJson, outputDir, exclusions = { source_index_ranges: [] } }) {
  const [originalBytes, editedBytes, recordsBytes] = await Promise.all([
    fs.readFile(originalDocx), fs.readFile(editedDocx), fs.readFile(recordsJson)
  ]);
  const rows = JSON.parse(recordsBytes).records;
  const originalParagraphs = paragraphs(originalBytes).filter(p => p.style === 'ChatMessage');
  if (originalParagraphs.length !== rows.length) throw new Error('Original Word message count mismatch');
  for (let i = 0; i < rows.length; i++) {
    if (originalParagraphs[i].text.replaceAll('\t', '') !== rows[i].time + rows[i].sender + rows[i].content) {
      throw new Error(`Original Word content mismatch at row ${i}`);
    }
  }
  const preference = selectedReplies(paragraphs(editedBytes), rows);
  if (preference.unresolved.length) throw new Error(`Unresolved preferred reply attribution: ${JSON.stringify(preference.unresolved)}`);
  const isExcluded = row => exclusions.source_index_ranges.some(range => row.index >= range.start && row.index <= range.end);
  const excludedQuoteTexts = new Set(rows.filter(isExcluded).map(row => normalize(row.content)));
  const toContext = row => {
    const record = publicRecord(row);
    if (row.quote && excludedQuoteTexts.has(normalize(row.quote.content))) record.quote = null;
    return record;
  };
  const originalOwnTurns = buildTurns(rows).filter(turn => turn.speaker === '我');
  const turns = buildTurns(rows, 120, isExcluded);
  const ownTurns = turns.filter(t => t.speaker === '我');
  const samples = [];
  const positions = new Map(rows.map((row, i) => [row.index, i]));
  for (const [number, turn] of ownTurns.entries()) {
    const before = positions.get(turn.records[0].index);
    const after = positions.get(turn.records.at(-1).index);
    const first = turn.records[0];
    const sourceIds = turn.records.map(row => row.index);
    const checks = [...new Set(turn.records.flatMap(row => reuseChecks(row.content)))];
    samples.push({
      id: `turn_${String(first.index).padStart(4, '0')}`,
      date: first.date,
      time: first.time,
      reply: turn.records.map(row => cleanName(row.content)),
      source_indices: sourceIds,
      preferred_source_indices: sourceIds.filter(index => preference.selected.has(index)),
      preferred_paragraphs: sourceIds.flatMap(index => preference.selected.get(index) ?? []),
      context_before: rows.slice(Math.max(0, before - 6), before).filter(row => row.sender !== '系统提示' && !isExcluded(row)).map(toContext),
      addressed_messages: turn.records.filter(row => row.quote && !excludedQuoteTexts.has(normalize(row.quote.content))).map(row => ({ replying_source_index: row.index, ...toContext(row).quote })),
      continuation_after: rows.slice(after + 1, after + 5).filter(row => row.sender !== '系统提示' && !isExcluded(row)).map(toContext),
      reuse_checks: checks,
      direct_reuse_blocked: checks.includes('identifier_or_address'),
      original_relationship_stage: 'not_assigned'
    });
  }
  const lengths = rows.filter(row => row.sender === '我').map(row => [...row.content].length).sort((a, b) => a - b);
  const stats = {
    source_record_count: rows.length,
    own_message_count: lengths.length,
    other_message_count: rows.filter(row => row.sender === '刘子睿').length,
    system_message_count: rows.filter(row => row.sender === '系统提示').length,
    own_text_turn_count: samples.length,
    original_own_text_turn_count: originalOwnTurns.length,
    eligible_own_message_count: rows.filter(row => row.sender === '我' && !isExcluded(row)).length,
    excluded_own_message_count: rows.filter(row => row.sender === '我' && isExcluded(row)).length,
    excluded_source_ranges: exclusions.source_index_ranges,
    grouping_rule: 'Consecutive text messages from the same speaker, separated by at most 120 seconds; system notices ignored.',
    preferred_appearances: preference.appearances,
    preferred_unique_messages: preference.selected.size,
    eligible_preferred_unique_messages: [...preference.selected.keys()].filter(index => !isExcluded({ index })).length,
    duplicate_preference_appearances: preference.appearances - preference.selected.size,
    own_char_median: lengths[Math.floor(lengths.length / 2)],
    own_messages_at_most_20_chars: lengths.filter(n => n <= 20).length,
    first_date: rows[0].date,
    last_date: rows.at(-1).date,
    source_verified_against_docx: true,
    sources: [originalDocx, editedDocx].map((filename, i) => ({ filename: path.basename(filename), sha256: crypto.createHash('sha256').update(i ? editedBytes : originalBytes).digest('hex') })),
    unresolved_preferences: preference.unresolved,
    conversation_context_scrubbed: ['telephone_numbers', 'identity_numbers', 'detailed_addresses', 'URL_values']
  };
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const save = (name, body) => fs.writeFile(path.join(outputDir, name), body, { mode: 0o600 });
  await save('reply_turns.json', JSON.stringify(samples, null, 2));
  await save('conversation.json', JSON.stringify(rows.filter(row => !isExcluded(row)).map(toContext), null, 2));
  await save('stats.json', JSON.stringify(stats, null, 2));
  return { stats, samples };
}
