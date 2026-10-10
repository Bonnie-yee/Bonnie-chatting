// Shared by the private Site Worker and local validation. No provider credentials.
export const BACKUP_REPOSITORY='Bonnie-yee/Bonnie-chatting';
export const BACKUP_PATH='sync/current_rules.json';
const KEY='bonnie/current_rules.json';
const empty=()=>({schema_version:1,revision:0,feedback:[],github_receipt:null});
const stages=['new','familiar','close'];
function fail(message){throw new Error(message);}
function string(value,name,max){if(typeof value!=='string'||!value.trim()||value.length>max)fail('Invalid '+name);return value.trim();}
export function validateFeedback(input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Invalid feedback');
  const keys=['id','subject','stage','verdict','messages','user_feedback','context','rule','scope'];
  if(Object.keys(input).some(key=>!keys.includes(key)))fail('Unknown feedback field');
  const id=string(input.id,'id',100);if(!/^[a-zA-Z0-9_-]+$/.test(id))fail('Invalid id');
  if(!['own_reply','practice_partner'].includes(input.subject))fail('Invalid subject');
  if(!stages.includes(input.stage))fail('Invalid stage');
  if(!['approve','reject','correction'].includes(input.verdict))fail('Invalid verdict');
  if(!Array.isArray(input.messages)||input.messages.length<1||input.messages.length>4)fail('Invalid messages');
  return {id,subject:input.subject,stage:input.stage,verdict:input.verdict,messages:input.messages.map(x=>string(x,'message',500)),user_feedback:string(input.user_feedback,'user_feedback',1000),context:string(input.context,'context',2500),rule:string(input.rule,'rule',1200),scope:string(input.scope,'scope',1000)};
}
export async function readCloudState(bucket){
  if(!bucket)fail('Cloud storage unavailable');
  const object=await bucket.get(KEY);
  return {state:object?JSON.parse(await object.text()):empty(),etag:object?.etag??null};
}
export async function saveFeedback(bucket,input){
  const record=validateFeedback(input);
  for(let attempt=0;attempt<5;attempt++){
    const {state,etag}=await readCloudState(bucket);
    const previous=state.feedback.find(x=>x.id===record.id);
    if(previous){const {created_at,...saved}=previous;if(JSON.stringify(saved)!==JSON.stringify(record))fail('Idempotency conflict');return {state,duplicate:true};}
    if(state.feedback.length>=2000)fail('Feedback store full; retain history before expanding');
    const next={...state,revision:state.revision+1,feedback:[...state.feedback,{...record,created_at:new Date().toISOString()}]};
    const json=JSON.stringify(next);if(new TextEncoder().encode(json).length>2_000_000)fail('Feedback store too large');
    const result=await bucket.put(KEY,json,{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}});
    if(result)return {state:next,duplicate:false};
  }
  fail('Concurrent change; retry with the same feedback id');
}
export function feedbackRules(state,subject='own_reply'){
  return state.feedback.filter(x=>x.subject===subject).map(x=>`- [${x.stage} / ${x.verdict}] ${x.rule} 适用范围：${x.scope}`).join('\n');
}
export function approvedFeedbackExamples(state){return state.feedback.filter(x=>x.subject==='own_reply'&&x.verdict==='approve').map(x=>({id:x.id,origin:'explicit_user_approved_feedback',stage:x.stage,messages:x.messages,context:x.context,rule:x.rule,scope:x.scope,user_feedback:x.user_feedback}));}
export function backupContent(state){
  return JSON.stringify({schema_version:1,revision:state.revision,feedback:state.feedback},null,2)+'\n';
}
export async function digest(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function backupPayload(state){const content=backupContent(state);return {repository_full_name:BACKUP_REPOSITORY,path:BACKUP_PATH,revision:state.revision,content,content_sha256:await digest(content)};}
export async function recordGithubReceipt(bucket,input){
  if(!input||!Number.isInteger(input.revision)||!/^[a-f0-9]{40}$/.test(input.commit_sha??'')||!/^[a-f0-9]{64}$/.test(input.content_sha256??''))fail('Invalid GitHub receipt');
  for(let attempt=0;attempt<5;attempt++){
    const {state,etag}=await readCloudState(bucket);
    if(state.revision!==input.revision)fail('A newer revision exists; back up current revision');
    const payload=await backupPayload(state);if(payload.content_sha256!==input.content_sha256)fail('Backup digest mismatch');
    const next={...state,github_receipt:{revision:input.revision,commit_sha:input.commit_sha,content_sha256:input.content_sha256,reported_at:new Date().toISOString(),verification:'agent_verified_provider_response'}};
    const result=await bucket.put(KEY,JSON.stringify(next),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}});if(result)return next;
  }
  fail('Concurrent change; reread sync status');
}
const props={id:{type:'string',description:'Stable id for this exact user feedback; reuse on retry.'},subject:{type:'string',enum:['own_reply','practice_partner']},stage:{type:'string',enum:stages},verdict:{type:'string',enum:['approve','reject','correction']},messages:{type:'array',items:{type:'string'},minItems:1,maxItems:4},user_feedback:{type:'string',description:'The actual words the user used to approve, reject or correct; never invent approval.'},context:{type:'string'},rule:{type:'string',description:'Contextual transferable rule. Preserve core exclusions and author boundaries.'},scope:{type:'string',description:'Where this rule applies; do not generalize one case to every relationship.'}};
const noArgs={type:'object',properties:{},additionalProperties:false};
export const toolsList=[
  {name:'bonnie_get_rules',description:'Read current personal reply rules and separate fictional practice-partner preferences. Read on starting a Bonnie project chat; do not learn ta voice as the user.',inputSchema:noArgs,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'bonnie_record_feedback',description:'Save the user\'s explicit feedback automatically. Call after a clear like/dislike/correction. Changes private cloud rules and HTML immediately. Own replies and fictional ta preferences are strictly separate. Then use GitHub tools with the returned fixed backup payload; never claim GitHub sync before verifying the provider result.',inputSchema:{type:'object',properties:props,required:Object.keys(props),additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:'bonnie_get_backup',description:'Get the latest complete feedback snapshot for the fixed private GitHub path. If GitHub receipt is behind, use installed GitHub tools to fetch the file SHA, create/update this exact path, read back and verify this exact content; report receipt. Never remove or overwrite unrelated files.',inputSchema:noArgs,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
  {name:'bonnie_report_backup',description:'Record the commit returned by a successful GitHub write after reading back the exact backed-up content. This endpoint records the caller\'s verification; it does not itself contact GitHub.',inputSchema:{type:'object',properties:{revision:{type:'integer'},commit_sha:{type:'string'},content_sha256:{type:'string'}},required:['revision','commit_sha','content_sha256'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];
export async function invokeCloudTool(name,args,bucket,base){
  if(name==='bonnie_get_rules'){const {state}=await readCloudState(bucket);return {revision:state.revision,core_policy:base.policy,practice_policy:base.practicePolicy,own_reply_rules:feedbackRules(state),approved_feedback_examples:approvedFeedbackExamples(state),practice_partner_preferences:feedbackRules(state,'practice_partner'),github_receipt:state.github_receipt,...(base.passwordSiteUrl?{password_website:{url:base.passwordSiteUrl,requires_password:true,view_without_chatgpt_account:true,purpose:'完整私人参考、全文搜索与上下文；AI 接话和对练仍使用原 GPT 工作项目。这是维护入口，不是本人风格样本。'}}:{})};}
  if(name==='bonnie_record_feedback'){const saved=await saveFeedback(bucket,args);return {cloud_saved:true,html_updated:true,duplicate:saved.duplicate,backup:await backupPayload(saved.state),github_synced:false,next_action:'Use the installed GitHub plugin to write this exact private backup, read back and verify it, then call bonnie_report_backup. If GitHub tools/consent are unavailable, retain pending state and tell the user once; do not ask for manual copying.'};}
  if(name==='bonnie_get_backup'){const {state}=await readCloudState(bucket);return {...await backupPayload(state),github_receipt:state.github_receipt,pending:state.github_receipt?.revision!==state.revision};}
  if(name==='bonnie_report_backup'){const state=await recordGithubReceipt(bucket,args);return {receipt_recorded:true,revision:state.revision,github_receipt:state.github_receipt};}
  fail('Unknown tool');
}
