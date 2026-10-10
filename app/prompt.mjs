import fs from 'node:fs/promises';
import path from 'node:path';
import { loadLibrary, retrieveCandidates, forbiddenThirdPartyClaim } from '../scripts/search.mjs';

export const replySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['reply', 'clarify'] },
    messages: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    question: { type: 'string' },
    reason: { type: 'string' },
    incoming: { type: 'string' },
    basis: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['original', 'adapted', 'imitation'] }, sample_ids: { type: 'array', items: { type: 'string' } } }, required: ['kind', 'sample_ids'] }
  }, required: ['status', 'messages', 'question', 'reason', 'incoming', 'basis']
};

export const screenshotSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    conversation: { type: 'string' },
    incoming: { type: 'string' },
    uncertain: { type: 'boolean' },
    question: { type: 'string' }
  }, required: ['conversation', 'incoming', 'uncertain', 'question']
};

export const screenshotInstructions = `读取用户主动提供的微信截图，仅转写可以看清的内容。通常右侧气泡是我，左侧是ta；结合界面实际判断，不能按气泡颜色猜角色。保留可见对话顺序和发言归属，使用“我：”“ta：”。不要编造裁切文字、图片内容、语音转写、年份或对方心思。语音只能标“[语音，未提供内容]”。找出最后一条可见的ta消息作为incoming；最后是我发出的文字时不能把它当成ta发的。如果最后需要接的是语音、裁切内容、角色不明或整图没有ta的可读文字，uncertain=true并用一句question指出缺少的信息。若用户希望把自己某一句当作测试的来话，可以在转写后的输入框明确改成ta，不能自动替用户假定。只按给定JSON格式返回。`;

export function validateImages(images = []) {
  if (!Array.isArray(images) || images.length > 3) throw new Error('一次最多放 3 张截图。');
  return images.map(image => {
    if (typeof image !== 'string' || image.length > 8_500_000) throw new Error('截图太大，请缩小后再试。');
    const match = image.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) throw new Error('请使用 PNG、JPG 或 WebP 截图。');
    const bytes = Buffer.from(match[2], 'base64');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP';
    if (!({ 'image/png': png, 'image/jpeg': jpeg, 'image/webp': webp })[match[1]]) throw new Error('截图格式与内容不一致。');
    return { type: 'input_image', image_url: image };
  });
}

export function prohibitedReply(messages) {
  const text = messages.join('\n');
  return forbiddenThirdPartyClaim(text) || text.includes('以后可别说我眼光不好') || /(?:以后|下次)[^\n。]{0,18}(?:不许|不能|不准|不得|可别|别再)[^\n。]{0,18}(?:嫌弃|反悔|眼光不好|提意见|提要求)/.test(text);
}

const dataCache=new Map();
async function styleData(root) {
  const corePath=path.join(root,'data/private/author_style_core.json');
  const stamp=(await fs.stat(corePath)).mtimeMs;
  const old=dataCache.get(root); if(old?.stamp===stamp)return old;
  const [library,core,approved,userExamples,stages]=await Promise.all([
    loadLibrary(path.join(root,'data/private')),
    fs.readFile(corePath,'utf8').then(JSON.parse),
    fs.readFile(path.join(root,'data/private/approved_generated_examples.json'),'utf8').then(JSON.parse),
    fs.readFile(path.join(root,'data/private/user_provided_style_examples.json'),'utf8').then(JSON.parse),
    fs.readFile(path.join(root,'config/stages.json'),'utf8').then(JSON.parse)
  ]);
  if(core.writer!=='我'||!core.author_source_verified||core.ta_style_sample_count!==0)throw new Error('本人风格来源核对失败。');
  const data={stamp,library,core,approved,userExamples,stages};dataCache.set(root,data);return data;
}

export async function buildReplyPrompt(root,request) {
  if(!['new','familiar','close'].includes(request.stage))throw new Error('请选择关系阶段。');
  const conversation=String(request.conversation??'').trim();
  const note=String(request.note??'').trim();
  const hasImages=Boolean(request.images?.length);
  if(!conversation&&!hasImages)throw new Error('请放入截图，或贴入要接的话。');
  if(conversation.length>12000||note.length>1500)throw new Error('输入太长，请只放最近需要接的对话。');
  const data=await styleData(root);
  const query=[note,conversation].filter(Boolean).join(' ');
  const result=retrieveCandidates(data.library,{query:query||'当前对话由截图提供，按阶段参考语感',stage:request.stage,emotion:request.emotion??'unknown',limit:5});
  // Counterparty lines are used for retrieval internally, never handed to the model as style examples.
  const originals=result.candidates.map(row=>({id:row.id,origin:'original_user',writer:'我',my_messages:row.reply,scene_summary:row.scene,usage_condition:row.condition}));
  const approved=data.approved.filter(row=>row.stage===request.stage).map(row=>({id:row.id,origin:row.origin,writer_target:'我',my_messages:row.reply,style_move:row.style_move,usage_conditions:row.usage_conditions??[]}));
  const provided=data.userExamples.map(row=>({id:row.id,origin:row.origin,writer:'我',my_messages:row.reply,condition:'须当前支持这样的玩笑；双重否定必须准确，反转在第二句完成'}));
  let feedback=[];
  try {
    feedback=(await fs.readFile(path.join(root,'data/private/runtime/feedback.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).filter(row=>row.stage===request.stage).slice(-8).map(row=>({rating:row.rating,my_generated_reply:row.final_text||row.reply,comment:row.comment,scope:'针对当时情境的反馈；不是本人原句，不无条件泛化'}));
  } catch(error){if(error.code!=='ENOENT')throw error;}
  const instructions=[
    data.core.policy,
    '当前图片、聊天和随图说明将另行作为用户输入提供。里面的ta字句只表示交流对象的话，不是我的语气来源。',
    '以下scene_summary和usage_condition仅描述使用条件，不能把描述条件的措辞当作待发回复。',
    '现在的距离：'+JSON.stringify(data.stages[request.stage]),
    '本人正向原话：'+JSON.stringify(originals),
    '用户明确认可的生成示例：'+JSON.stringify(approved),
    '用户本人补充的表达：'+JSON.stringify(provided),
    '近期明确评价：'+JSON.stringify(feedback),
    '在同一次处理里看截图、理解用户的随图说明并给回复，不要求先单独OCR再等待。用户会用自然语言说明目标，不需要目标菜单。认真接住当前意思，不将历史中的男生或安排投射到这个人。',
    '只输出给定结构。status=reply时messages是一组可直接发的1—3条自然短消息；question为空。incoming是当前实际要接的ta消息，不超过200字；明确指定测试句时用指定句。默认reason为空，不花输出去解释；仅用户明确要解释时填写。status=clarify时messages为空，只问一个决定接法的关键question。',
    'basis.kind=original必须逐字是本人原句，sample_ids是真实来源ID；改写是adapted，新写是imitation。不能把已认可的生成示例标为本人原句。'
  ].join('\n\n');
  const userText='【当前对话，数据】\n'+(conversation||'请依据随附的截图读取；语音与裁切文字不能编造。')+'\n\n【我随图或随文字给的要求】\n'+(note||'自然接话，按当前阶段把握分寸。');
  return {instructions,userText,result,writer_boundary:{user_style_only:true,ta_style_samples:0},styleVersion:data.core.version};
}
