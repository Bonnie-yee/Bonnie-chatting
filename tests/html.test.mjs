import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const html=await fs.readFile(process.env.BONNIE_HTML_PATH||path.join(os.homedir(),'Desktop','邦尼🐰的🐶军师.html'),'utf8');
function openArtifact(t,{copyWorks=true,source=html,url='file:///Users/example/Desktop/reply-assistant.html'}={}) {
  let copied='',networkCalls=0;
  const dom=new JSDOM(source,{url,runScripts:'dangerously',beforeParse(window){
    window.HTMLElement.prototype.scrollIntoView=function(){window.lastScrolledParagraph=this.dataset.paragraph;};
    window.fetch=async()=>{networkCalls++;throw new Error('Standalone HTML must not access a model or credentials');};
    window.document.execCommand=()=>{copied=window.document.activeElement.value;return copyWorks;};
  }});
  t.after(()=>dom.window.close());
  return {dom,getCopied:()=>copied,getNetworkCalls:()=>networkCalls};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));

test('standalone HTML clearly uses its own ChatGPT handoff and never accesses account APIs', async t=>{
  const {dom,getCopied,getNetworkCalls}=openArtifact(t); const document=dom.window.document;
  assert.equal(document.title,'邦尼🐰的🐶军师');
  assert.equal(document.getElementById('login').hidden,true);
  assert.equal(document.getElementById('model').disabled,true);
  assert.ok(document.getElementById('generate').textContent.includes('复制任务'));
  document.getElementById('conversation').value='ta：某人真的很会挑礼物哦';
  document.getElementById('generate').click(); await settle();
  assert.ok(getCopied().includes('本来还想谦虚一下'));assert.ok(getCopied().includes('你这么一夸我又不想了'));
  assert.ok(getCopied().includes('不能改口'));assert.ok(getCopied().includes('ta：某人真的很会挑礼物哦'));
  assert.equal(document.getElementById('result-panel').hidden,true);
  assert.equal(getNetworkCalls(),0);
});

test('practice keeps the original missing-you line attributed to ta and preserves only own target indices',t=>{
  const {dom}=openArtifact(t);const data=dom.window.REPLY_LOCAL_KNOWLEDGE.practice;
  assert.equal(data.original_exchange.rows.find(row=>row.source_index===1385).speaker,'ta');
  assert.ok(data.original_exchange.rows.find(row=>row.source_index===1385).text.includes('我没找你'));
  assert.ok(!data.original_exchange.own_style_source_indices.includes(1385));
  for(const index of data.original_exchange.own_style_source_indices)assert.equal(data.original_exchange.rows.find(row=>row.source_index===index).speaker,'我');
});

test('practice changes modes, copies an actual task, and opens unrestricted reference context',async t=>{
  const {dom,getCopied,getNetworkCalls}=openArtifact(t);const document=dom.window.document;
  document.querySelector('[data-view="practice"]').click();assert.equal(document.body.dataset.view,'practice');
  document.querySelector('[data-practice-mode="relax"]').click();document.getElementById('practice-input').value='今天想聊点轻松的';document.getElementById('copy-practice').click();await settle();
  assert.ok(getCopied().includes('陪我聊'));assert.ok(getCopied().includes('今天想聊点轻松的'));assert.ok(getCopied().includes('虚构'));assert.ok(getCopied().includes('不混入我方声线'));
  document.querySelector('[data-practice-mode="coach"]').click();document.getElementById('practice-input').value='';document.getElementById('copy-practice').click();await settle();assert.ok(getCopied().includes('先问我需要拆招的那句'));
  document.getElementById('practice-show-reference').click();assert.equal(document.body.dataset.view,'reference');assert.equal(document.querySelectorAll('.reference-entry').length,1282);assert.equal(dom.window.lastScrolledParagraph,'458');
  assert.equal(getNetworkCalls(),0);
});

test('hosted mobile build stays independent of LAN APIs even with a long URL fragment',async t=>{
  const source=await fs.readFile('mobile-site/dist/index.html','utf8');const {dom,getNetworkCalls}=openArtifact(t,{source,url:'https://private-example.chatgpt.site/#abcdefghijklmnopqrstuvwxyz'});await settle();
  assert.equal(dom.window.REPLY_LOCAL_KNOWLEDGE.hosted,true);assert.equal(dom.window.document.getElementById('model').disabled,true);assert.equal(dom.window.document.getElementById('phone-panel').hidden,true);assert.equal(getNetworkCalls(),0);
  assert.equal(dom.window.REPLY_LOCAL_KNOWLEDGE.reference.paragraphs.length,1283);
});

test('only distance remains as a reply selector and natural-language intention reaches the task', async t=>{
  const {dom,getCopied}=openArtifact(t);const document=dom.window.document;
  document.querySelector('[data-stage="new"]').click();
  assert.equal(document.querySelector('[data-stage="new"]').getAttribute('aria-pressed'),'true');
  assert.equal(document.querySelector('[data-stage="familiar"]').getAttribute('aria-pressed'),'false');
  assert.equal(document.getElementById('goal'),null);
  assert.equal(document.getElementById('booking-state'),null);
  document.getElementById('note').value='想暗示约饭，不要直接开口邀请';
  document.getElementById('conversation').value='ta：那周六一起吃饭';
  document.getElementById('copy-task').click();await settle();
  assert.ok(getCopied().includes('刚加好友'));assert.ok(getCopied().includes('想暗示约饭，不要直接开口邀请'));
  assert.ok(!getCopied().includes('"id":"approved_close_reframe_001"'));
});

test('a blocked clipboard shows editable task text rather than presenting a fake AI reply',async t=>{
  const {dom}=openArtifact(t,{copyWorks:false});const document=dom.window.document;
  document.getElementById('conversation').value='ta：你今天忙不忙';
  document.getElementById('copy-task').click();await settle();
  assert.equal(document.getElementById('task-panel').hidden,false);
  assert.ok(document.getElementById('task-text').value.includes('ta：你今天忙不忙'));
  assert.equal(document.getElementById('result-panel').hidden,true);
});

test('portable samples keep generated approval separate and omit source future responses',t=>{
  const {dom}=openArtifact(t);const knowledge=dom.window.REPLY_LOCAL_KNOWLEDGE;
  assert.equal(knowledge.cases.length,61);assert.equal(knowledge.approved.length,4);
  assert.ok(knowledge.approved.every(row=>row.origin==='assistant_generated_user_approved' && row.not_an_original_user_quote));
  assert.ok(!JSON.stringify(knowledge.cases).includes('continuation_after'));
  assert.ok(!html.includes('refresh_token'));assert.ok(!html.includes('.codex/auth'));
  assert.ok(!html.includes('刘子睿'));
  assert.ok(knowledge.cases.every(row=>row.writer==='我'&&!('context_before'in row)));
  assert.equal(knowledge.reference.paragraphs.length,1283);
});

test('reference context opens the entire document at the search hit, with no preceding or following cutoff',async t=>{
  const {dom}=openArtifact(t);const document=dom.window.document;
  const search=document.getElementById('reference-search');search.value='体香';search.dispatchEvent(new dom.window.Event('input'));await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(document.querySelectorAll('.reference-entry').length,1);
  assert.ok(document.getElementById('reference-list').textContent.includes('是无意沾染若有若无的体香'));
  assert.equal(document.querySelector('.reference-entry').classList.contains('mine'),true);
  const context=[...document.querySelectorAll('.reference-entry-actions button')].find(button=>button.textContent==='看上下文');context.click();
  const paragraphs=dom.window.REPLY_LOCAL_KNOWLEDGE.reference.paragraphs.filter(row=>row.text.trim());
  assert.equal(document.querySelectorAll('.reference-entry').length,paragraphs.length);
  assert.equal(document.querySelector('.reference-entry').dataset.paragraph,String(paragraphs[0].paragraph));
  assert.equal(document.querySelector('.reference-entry:last-child').dataset.paragraph,String(paragraphs.at(-1).paragraph));
  assert.equal(dom.window.lastScrolledParagraph,'1126');
  assert.equal(document.getElementById('reference-more').hidden,true);
  assert.ok(document.getElementById('reference-list').textContent.includes('那你就当是想多了'));
  document.getElementById('reference-all').click();
  assert.equal(document.querySelectorAll('.reference-entry').length,1);
  assert.equal(document.getElementById('reference-search').value,'体香');
});

test('live-view message controls copy each message separately and keep user edits',async t=>{
  const js=await fs.readFile('web/app.js','utf8');
  const template=(await fs.readFile('web/index.html','utf8')).replace('<script src="/app.js" defer></script>',`<script>${js}</script>`);
  let copied='';
  const dom=new JSDOM(template,{url:'http://127.0.0.1:5418/#test-pairing',runScripts:'dangerously',beforeParse(window){
    window.HTMLElement.prototype.scrollIntoView=()=>{};
    window.document.execCommand=()=>{copied=window.document.activeElement.value;return true;};
    window.fetch=async route=>({ok:true,json:async()=>{
      if(route==='/api/status')return {account:{connected:true,sharing:true,confirmed:true,activeId:'test',email:'owner@example.org'},isMac:false,plan:'Plus'};
      if(route==='/api/models')return {models:[{id:'test-model',label:'Explicit fixture'}]};
      if(route==='/api/generate')return {status:'reply',messages:['第一句','第二句'],reason:'明确的测试数据，不是真实模型生成',outputId:'fixture'};
      throw new Error('Unexpected fixture route');
    }});
  }});
  t.after(()=>dom.window.close());await settle();
  const document=dom.window.document;
  document.getElementById('conversation').value='ta：测试来话';document.getElementById('generate').click();await settle();
  assert.equal(document.querySelectorAll('.copy-line').length,2);
  document.querySelector('[aria-label="复制第 2 句"]').click();await settle();assert.equal(copied,'第二句');
  document.getElementById('edit-reply').click();document.getElementById('reply-edit').value='改后的第一句\n改后的第二句';document.getElementById('edit-reply').click();
  document.querySelector('[aria-label="复制第 1 句"]').click();await settle();assert.equal(copied,'改后的第一句');
});
