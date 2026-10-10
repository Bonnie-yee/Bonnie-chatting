import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {saveFeedback,readCloudState,feedbackRules,approvedFeedbackExamples,backupPayload,recordGithubReceipt,invokeCloudTool} from '../app/cloud-feedback.mjs';
globalThis.crypto??=webcrypto;
// Explicit R2 fixture; successful tests do not establish hosted authentication.
class Bucket{value=null;etag=null;counter=0;async get(){if(!this.value)return null;const value=this.value;return {etag:this.etag,text:async()=>value};}async put(key,value,{onlyIf}={}){if(onlyIf?.etagMatches&&onlyIf.etagMatches!==this.etag)return null;if(onlyIf?.etagDoesNotMatch==='*'&&this.value)return null;this.value=value;this.etag=String(++this.counter);return {etag:this.etag};}}
const feedback=(id='f1',subject='own_reply',verdict='reject')=>({id,subject,stage:'familiar',verdict,messages:['未获认可的测试候选'],user_feedback:'太直白了',context:'明确的测试情境',rule:'接住一句就收，不追加特殊待遇声明。',scope:'第二阶段的含蓄接话'});
test('duplicate feedback is idempotent, conflicting IDs are rejected and concurrent saves preserve both records',async()=>{
 const bucket=new Bucket();await Promise.all([saveFeedback(bucket,feedback('one')),saveFeedback(bucket,feedback('two'))]);assert.equal((await readCloudState(bucket)).state.revision,2);
 assert.equal((await saveFeedback(bucket,feedback('one'))).duplicate,true);assert.equal((await readCloudState(bucket)).state.feedback.length,2);
 await assert.rejects(()=>saveFeedback(bucket,{...feedback('one'),rule:'changed'}),/Idempotency conflict/);
});
test('practice partner preferences never enter own voice rules; saving alone does not claim GitHub completion',async()=>{
 const bucket=new Bucket();const own=await invokeCloudTool('bonnie_record_feedback',feedback(),bucket,{});assert.equal(own.github_synced,false);assert.equal(own.html_updated,true);
 await saveFeedback(bucket,{...feedback('partner','practice_partner','approve'),rule:'只适用于虚构ta的测试偏好'});const {state}=await readCloudState(bucket);assert.ok(!feedbackRules(state).includes('虚构ta'));assert.ok(feedbackRules(state,'practice_partner').includes('虚构ta'));
 assert.equal((await invokeCloudTool('bonnie_get_backup',{},bucket,{})).pending,true);
});
test('backup target is fixed and receipt rejects stale revisions or wrong digest',async()=>{
 const bucket=new Bucket();await saveFeedback(bucket,feedback());const {state}=await readCloudState(bucket);const payload=await backupPayload(state);
 assert.equal(payload.repository_full_name,'Bonnie-yee/Bonnie-chatting');assert.equal(payload.path,'sync/current_rules.json');assert.ok(!payload.content.includes('github_receipt'));
 await assert.rejects(()=>recordGithubReceipt(bucket,{revision:1,commit_sha:'a'.repeat(40),content_sha256:'b'.repeat(64)}),/digest mismatch/);
 await recordGithubReceipt(bucket,{revision:1,commit_sha:'a'.repeat(40),content_sha256:payload.content_sha256});assert.equal((await invokeCloudTool('bonnie_get_backup',{},bucket,{})).pending,false);
 await saveFeedback(bucket,feedback('next'));assert.equal((await invokeCloudTool('bonnie_get_backup',{},bucket,{})).pending,true);
 await assert.rejects(()=>recordGithubReceipt(bucket,{revision:1,commit_sha:'a'.repeat(40),content_sha256:payload.content_sha256}),/newer revision/);
});
test('feedback cannot choose files, repository, role or unsupported stage',async()=>{
 const bucket=new Bucket();for(const patch of [{path:'../../secret'},{subject:'ta'},{stage:'anything'},{messages:[]}])await assert.rejects(()=>saveFeedback(bucket,{...feedback(),...patch}));
});
test('only explicitly approved own replies enter cloud example material',async()=>{
 const bucket=new Bucket();await saveFeedback(bucket,feedback('rejected','own_reply','reject'));await saveFeedback(bucket,feedback('accepted','own_reply','approve'));await saveFeedback(bucket,feedback('partner','practice_partner','approve'));
 const examples=approvedFeedbackExamples((await readCloudState(bucket)).state);assert.deepEqual(examples.map(x=>x.id),['accepted']);assert.equal(examples[0].origin,'explicit_user_approved_feedback');assert.equal(examples[0].stage,'familiar');
});
