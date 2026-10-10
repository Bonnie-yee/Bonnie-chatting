import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { ChatGPTAccount, validateIdentity } from '../app/account.mjs';
import { consumeResponse } from '../app/inference.mjs';
import { buildReplyPrompt, prohibitedReply, validateImages } from '../app/prompt.mjs';
import { createReplyServer } from '../app/server.mjs';

const root = path.resolve('');
const temp = async t => { const directory = await fs.mkdtemp(path.join(os.tmpdir(),'personal-reply-test-')); t.after(() => fs.rm(directory,{recursive:true,force:true})); return directory; };

test('independent login never creates an inferred session from existing environment credentials', async t => {
  const account = new ChatGPTAccount(await temp(t)); await account.init();
  assert.equal(account.view().connected,false); assert.equal(account.view().confirmed,false);
  await assert.rejects(account.accessToken(), /自己的 ChatGPT/);
});

test('wrong account callback is rejected before any credential record is stored', async t => {
  const directory=await temp(t);
  const account = new ChatGPTAccount(directory, {
    expectedEmail:'owner@example.org',
    fetchImpl: async () => new Response(JSON.stringify({id_token:'fixture',access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,scope:'chatgpt.tokens.use.direct'})),
    verifyIdentity: async () => ({subject:'another-person',issuer:'https://auth.openai.com',email:'other@example.org'})
  });
  await account.init(); t.after(() => account.finishPending());
  const {authUrl}=await account.startLogin(); const auth=new URL(authUrl);
  assert.equal(auth.searchParams.get('client_id'),'dynamic_agent_client');
  assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
  const callback=new URL(auth.searchParams.get('redirect_uri'));
  callback.search=new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code',client_id:'oaiapp_fixture'});
  const response=await fetch(callback);
  assert.equal(response.status,400); assert.equal(account.view().connected,false);
  assert.equal((await fs.readdir(directory)).some(name=>name.startsWith('connection-')),false);
});

test('valid own-account login waits for explicit ownership confirmation and cannot replay its callback', async t => {
  const directory=await temp(t); let exchanges=0;
  const account = new ChatGPTAccount(directory, {
    expectedEmail:'owner@example.org',
    fetchImpl: async () => {exchanges++; return new Response(JSON.stringify({id_token:'fixture',access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,scope:'chatgpt.tokens.use.direct'}));},
    verifyIdentity: async () => ({subject:'owner',issuer:'https://auth.openai.com',email:'owner@example.org'})
  });
  await account.init(); t.after(()=>account.finishPending());
  const {authUrl}=await account.startLogin(); const auth=new URL(authUrl);
  const callback=new URL(auth.searchParams.get('redirect_uri'));
  callback.search=new URLSearchParams({state:'wrong-state',code:'fixture',client_id:'oaiapp_fixture'});
  assert.equal((await fetch(callback)).status,400); assert.equal(exchanges,0);
  callback.searchParams.set('state',auth.searchParams.get('state'));
  assert.equal((await fetch(callback)).status,200); assert.equal(exchanges,1);
  await assert.rejects(account.accessToken(),/确认这是你自己的/);
  await account.confirmOwner(); assert.equal(await account.accessToken(),'fixture-access');
  assert.equal((await fs.stat(account.credentialPath(account.active.id))).mode & 0o777,0o600);
  const view=JSON.stringify(account.view()); assert.ok(!view.includes('fixture-access')); assert.ok(!view.includes('fixture-refresh'));
});

test('identity validation rejects bad signatures, wrong nonce, wrong audience, and missing expiry', async () => {
  const pair=await generateKeyPair('RS256'); const key=await exportJWK(pair.publicKey); key.kid='test';
  const keySet=createLocalJWKSet({keys:[key]});
  const signed=async ({nonce='expected',audience='oaiapp_test',expiry=true}={}) => {
    let jwt=new SignJWT({nonce,email:'owner@example.org'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://auth.openai.com').setAudience(audience).setSubject('owner');
    if(expiry)jwt=jwt.setExpirationTime('5m'); return jwt.sign(pair.privateKey);
  };
  assert.equal((await validateIdentity(await signed(),'oaiapp_test','expected',keySet)).subject,'owner');
  await assert.rejects(validateIdentity(await signed({nonce:'wrong'}),'oaiapp_test','expected',keySet));
  await assert.rejects(validateIdentity(await signed({audience:'different'}),'oaiapp_test','expected',keySet));
  await assert.rejects(validateIdentity(await signed({expiry:false}),'oaiapp_test','expected',keySet));
  const other=await generateKeyPair('RS256');
  const forged=await new SignJWT({nonce:'expected'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://auth.openai.com').setAudience('oaiapp_test').setSubject('owner').setExpirationTime('5m').sign(other.privateKey);
  await assert.rejects(validateIdentity(forged,'oaiapp_test','expected',keySet));
});

function stream(events) {
  const bytes=new TextEncoder().encode(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''));
  return new Response(new ReadableStream({start(controller){ for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7)); controller.close();}}));
}
test('fragmented Chinese SSE is accepted only after completed inference', async () => {
  const result=await consumeResponse(stream([{type:'response.output_text.delta',delta:'这句'},{type:'response.output_text.delta',delta:'可以'},{type:'response.completed',response:{usage:{input_tokens:10}}}]));
  assert.equal(result.text,'这句可以'); assert.equal(result.usage.input_tokens,10);
  await assert.rejects(consumeResponse(stream([{type:'response.output_text.delta',delta:'半句'}])),/未完成/);
  await assert.rejects(consumeResponse(stream([{type:'response.output_text.delta',delta:'半句'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/额度暂时用完/);
});

test('approved reversals and feedback-space restriction actually reach the runtime prompt', async () => {
  const built=await buildReplyPrompt(root,{stage:'familiar',goal:'reply',emotion:'playful',conversation:'ta：某人真的很会挑礼物哦'});
  assert.ok(built.instructions.includes('本来还想谦虚一下')); assert.ok(built.instructions.includes('你这么一夸我又不想了'));
  assert.ok(built.instructions.includes('未来不能改口')); assert.ok(!built.instructions.includes('continuation_after'));
  assert.ok(!built.instructions.includes('"id":"approved_close_reframe_001"'));
  assert.equal(prohibitedReply(['那这句话我可记下了','以后可别说我眼光不好']),true);
  assert.equal(prohibitedReply(['本来还想谦虚一下','你这么一夸我又不想了']),false);
});

test('writer-only prompt excludes the counterparty perfume lines and preserves the own natural-impression mechanism',async()=>{
  const built=await buildReplyPrompt(root,{stage:'familiar',conversation:'ta：你怎么还记得我喜欢这个',note:'轻轻拉扯，不要直白说很在意'});
  assert.equal(built.writer_boundary.ta_style_samples,0);
  assert.ok(built.instructions.includes('是无意沾染若有若无的体香'));
  assert.ok(!built.instructions.includes('能闻到你的香水味 也是有点小心机了'));
  assert.ok(!built.instructions.includes('妹妹会花这么多心思么'));
  assert.ok(!built.instructions.includes('context_before'));
  assert.ok(built.userText.includes('轻轻拉扯，不要直白说很在意'));
});

test('screenshot and user intention are sent in one generation rather than an OCR-then-generation sequence',async t=>{
  const directory=await temp(t);
  const required=['config/stages.json','data/private/annotated_cases.json','data/private/reply_turns.json','data/private/stats.json','data/private/author_style_core.json','data/private/approved_generated_examples.json','data/private/user_provided_style_examples.json'];
  for(const file of required){await fs.mkdir(path.dirname(path.join(directory,file)),{recursive:true});await fs.copyFile(file,path.join(directory,file));}
  let calls=0,captured=null;
  const account={init:async()=>{},view:()=>({connected:true,confirmed:true,sharing:true,activeId:'test'}),finishPending:()=>{}};
  const inference={models:async()=>[{id:'test-model',label:'Explicit fixture'}],generate:async request=>{calls++;captured=request;return {value:{status:'reply',messages:['测试用完整回复'],incoming:'明确的测试来话',question:'',reason:'',basis:{kind:'imitation',sample_ids:[]}}};}};
  const app=await createReplyServer({root:directory,session:'test-pairing',account,inference,host:'127.0.0.1',port:0});
  t.after(()=>new Promise(resolve=>{app.server.closeAllConnections();app.server.close(resolve);}));
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5sAAAAASUVORK5CYII=';
  const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api/generate`,{method:'POST',headers:{'X-Reply-Session':'test-pairing','Content-Type':'application/json'},body:JSON.stringify({stage:'familiar',conversation:'',note:'暗示他主动约饭',images:[image]})});
  assert.equal(response.status,200);assert.equal(calls,1);
  assert.ok(captured.input[0].content.some(part=>part.type==='input_image'));
  assert.ok(captured.input[0].content[0].text.includes('暗示他主动约饭'));
  const result=await response.json();assert.equal(typeof result.elapsedMs,'number');assert.equal(result.speedTargetMs,10000);
});

test('uploads reject disguised text and SVG data URLs', () => {
  assert.throws(()=>validateImages(['data:image/png;base64,'+Buffer.from('not a picture').toString('base64')]),/不一致/);
  assert.throws(()=>validateImages(['data:image/svg+xml;base64,PHN2Zz4=']),/PNG/);
});

test('server rejects missing pairing, foreign origins, and generation before own-account confirmation', async t => {
  const directory=await temp(t); await fs.mkdir(path.join(directory,'web'),{recursive:true});
  await fs.writeFile(path.join(directory,'web/index.html'),'<!doctype html><title>test</title>');
  let modelCalls=0;
  const account={init:async()=>{},view:()=>({connected:true,confirmed:false,sharing:true,activeId:'test'}),finishPending:()=>{}};
  const inference={models:async()=>{modelCalls++;return[];},generate:async()=>{throw new Error('must never be called');}};
  const app=await createReplyServer({root:directory,session:'test-pairing',account,inference,host:'127.0.0.1',port:0});
  t.after(()=>new Promise(resolve=>{app.server.closeAllConnections();app.server.close(resolve);}));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/api/status')).status,401);
  assert.equal((await fetch(base+'/api/status',{headers:{'X-Reply-Session':'test-pairing',Origin:'https://different.example'}})).status,403);
  assert.equal((await fetch(base+'/data/private/client_preferences.json')).status,404);
  const response=await fetch(base+'/api/generate',{method:'POST',headers:{'X-Reply-Session':'test-pairing','Content-Type':'application/json'},body:JSON.stringify({conversation:'ta：你好',stage:'familiar',goal:'reply',emotion:'playful'})});
  assert.equal(response.status,400); assert.equal(modelCalls,0);
});
