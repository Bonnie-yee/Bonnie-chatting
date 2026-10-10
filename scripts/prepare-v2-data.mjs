import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {unzip, cleanName} from './corpus.mjs';
import {privateJson} from '../app/account.mjs';
import {filterReference} from './reference-policy.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function sourcePath(portable, legacy) {
  const candidate=path.join(root,'source_documents',portable);
  try {await fs.access(candidate);return candidate;}catch {return path.join(root,legacy);}
}
const decode=text=>text.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[entity]??String.fromCodePoint(entity[1]==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10)));
export function extractReference(buffer) {
  const xml=unzip(buffer).get('word/document.xml').toString('utf8');
  const rows=[...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map((match,index)=>{
    const text=cleanName([...match[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)].map(token=>token[1]!==undefined?decode(token[1]):token[2]==='tab'?'\t':'\n').join(''));
    const labelled=text.match(/^(\d{2}:\d{2}:\d{2})\t(我|ta|系统提示)\t([\s\S]*)$/);
    const quotation=text.match(/^引用\s*(我|ta)[：:]/);
    return {paragraph:index+1,text,time:labelled?.[1]??null,speaker:labelled?.[2]??null,body:labelled?.[3]??text,quote_speaker:quotation?.[1]??null,highlighted:/<w:highlight\b[^>]*w:val="yellow"/.test(match[0]),reference_only:true};
  });
  return filterReference({title:'参考',source_name:'新聊天记录_ta版.docx',source_sha256:crypto.createHash('sha256').update(buffer).digest('hex'),paragraph_count:rows.length,paragraphs:rows});
}

export async function prepareData() {
  const raw=JSON.parse(await fs.readFile(await sourcePath('text_only_records_ta.json','../.wechat-export-tools/.private-export/text_only_records.json'),'utf8')).records;
  const source=new Map(raw.map(row=>[row.index,row]));
  const cases=JSON.parse(await fs.readFile(path.join(root,'data/private/annotated_cases.json'),'utf8'));
  const turns=JSON.parse(await fs.readFile(path.join(root,'data/private/reply_turns.json'),'utf8'));
  const scentIds=[2483,2484];
  const scentReply=scentIds.map(id=>{const row=source.get(id);if(row?.sender!=='我')throw new Error('Scent case author mismatch');return cleanName(row.content);});
  const preferred=new Set(turns.flatMap(turn=>turn.preferred_source_indices));
  const newCase={id:'natural_impression_reframe',source_indices:scentIds,date:'2026-06-20',time:'19:04:20',reply:scentReply,preferred:scentIds.some(id=>preferred.has(id)),allowed_stages:['familiar','close'],mode:'playful',scene:'对方猜测你留下的某种印象是否刻意安排',move:'把刻意的解释轻轻换成自然留下的印象，将物品话题转回人但保留余地',inferred_subtext:'允许对方自己领会亲近，不正面说明全部意图',condition:'轻松互动且当前已有相应线索；没有香味线索时迁移动作，不照搬体香或虚构接触；认真确认与真实不高兴时不用它回避',retrieval_hints:['香水','体香','气味','刻意','无意','想多','留白','暗示','记住偏好'],context_before:[2470,2475,2476,2479,2480].map(id=>{const row=source.get(id);return {source_index:id,date:row.date,time:row.time,speaker:row.sender==='我'?'我':'ta',text:cleanName(row.content),quote:null};}),addressed_messages:[{speaker:'ta',text:cleanName(source.get(2479).content)}],continuation_after:[],source_type:'original',review_status:'context_reviewed',stage_assignment:'recommended_applicability_not_original_relationship_state',emphasized_by_user_on:'2026-10-10'};
  const prior=cases.findIndex(row=>row.id===newCase.id);if(prior<0)cases.push(newCase);else cases[prior]=newCase;
  for(const example of cases)for(const [offset,id]of example.source_indices.entries()){const row=source.get(id);if(row?.sender!=='我'||cleanName(row.content)!==example.reply[offset])throw new Error('A non-user utterance entered the style cases');}
  await privateJson(path.join(root,'data/private/annotated_cases.json'),cases);
  const authorGroups=turns.map(turn=>({id:turn.id,source_type:'original_user',writer:'我',source_indices:turn.source_indices,messages:turn.reply,preferred:turn.preferred_source_indices.length>0}));
  for(const turn of authorGroups)for(const [offset,id]of turn.source_indices.entries()){if(source.get(id)?.sender!=='我'||cleanName(source.get(id).content)!==turn.messages[offset])throw new Error('Author-only source verification failed');}
  const policy=await fs.readFile(path.join(root,'config/author_only_prompt.md'),'utf8');
  const core={version:'2026-10-10-author-only-v2',writer:'我',author_source_verified:true,user_message_count:authorGroups.reduce((sum,row)=>sum+row.messages.length,0),ta_style_sample_count:0,policy,scent:{source_indices:scentIds,my_words:scentReply,earlier_my_words:[source.get(2475).content,source.get(2476).content],intent_is_inference:true,mechanism:['物品转回人本身的印象','用无意留下轻否认','用若有若无控制浓度','让含义可以被领会而不被解释到底'],do_not_transfer:['对方的点破式措辞','香味或身体接触的旧事实','体香这个词到无关话题']}};
  await privateJson(path.join(root,'data/private/author_style_core.json'),core);
  await privateJson(path.join(root,'data/private/author_reply_groups.json'),authorGroups);
  const reference=extractReference(await fs.readFile(await sourcePath('reference_ta.docx','../新聊天记录_ta版.docx')));
  await privateJson(path.join(root,'data/private/reference_document.json'),reference);
  await privateJson(path.join(root,'analysis/体香与作者边界校正.json'),{date:'2026-10-10',user_correction:'只模仿我的风格，ta的风格不进入助手；重点理解体香表达的感觉与迁移',source_verified:true,core,reference_is_not_style_corpus:true,reference_paragraphs:reference.paragraph_count});
  return {original_cases:cases.length,author_groups:authorGroups.length,author_messages:core.user_message_count,ta_style_samples:0,reference_paragraphs:reference.paragraph_count};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await prepareData()));
