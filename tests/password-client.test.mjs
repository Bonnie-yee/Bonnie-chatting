import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pbkdf2Sync,webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
globalThis.crypto??=webcrypto;
const source=await fs.readFile('password-site/dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const config=JSON.parse(await fs.readFile('password-site/vault-config.json','utf8'));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t){
 const objects=new Map();let version=0;const password='fixture-password';
 const env={VAULT_ENCRYPTION_KEY:pbkdf2Sync(password,Buffer.from(config.salt,'base64'),600000,32,'sha256').toString('base64'),VAULT_SYNC_TOKEN:'fixture-only',BUCKET:{get:async key=>{const value=objects.get(key);return value?{etag:value.etag,text:async()=>value.text}:null;},put:async(key,text,options)=>{const old=objects.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const saved={etag:String(++version),text};objects.set(key,saved);return saved;}}};
 const gate=await(await worker.fetch(new Request('https://fixture.chatgpt.site/'),env)).text();
 const dom=new JSDOM(gate,{url:'https://fixture.chatgpt.site/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
  Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=function(){w.lastScrolledParagraph=this.dataset.paragraph;};
  w.fetch=async(path,options)=>worker.fetch(new Request(new URL(path,w.location.href),options),env);
  w.document.execCommand=()=>true;
 }});t.after(()=>dom.window.close());return {dom,password};
}
async function submit(dom,password){const d=dom.window.document;d.getElementById('password').value=password;d.getElementById('unlock-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));for(let n=0;n<100&&d.getElementById('unlock').disabled;n++)await pause(20);}
test('password unlock renders real reference in the same document without a Blob or iframe',async t=>{
 const {dom,password}=await fixture(t);await submit(dom,password);const d=dom.window.document;
 assert.equal(d.getElementById('gate').hidden,true);assert.equal(d.getElementById('opened').hidden,false);
 assert.equal(d.querySelector('iframe'),null);assert.equal(d.body.dataset.view,'reference');
 assert.equal(dom.window.REPLY_LOCAL_KNOWLEDGE.reference.paragraphs.length,1283);assert.equal(d.querySelectorAll('.reference-entry').length,120);
 d.getElementById('reference-search').value='体香';d.getElementById('reference-search').dispatchEvent(new dom.window.Event('input'));await pause(100);
 assert.ok(d.querySelector('.reference-entry-body').textContent.includes('体香'));
 [...d.querySelectorAll('.reference-entry-actions button')].find(b=>b.textContent==='看上下文').click();
 assert.equal(d.querySelectorAll('.reference-entry').length,1282);assert.ok(d.getElementById('reference-count').textContent.includes('完整上下文'));
});
test('incorrect password leaves no private content mounted and displays an actual error',async t=>{
 const {dom}=await fixture(t);await submit(dom,'incorrect-fixture');const d=dom.window.document;
 assert.equal(d.getElementById('gate').hidden,false);assert.equal(d.getElementById('opened').hidden,true);
 assert.equal(d.getElementById('private-app').childElementCount,0);assert.equal(dom.window.REPLY_LOCAL_KNOWLEDGE,undefined);
 assert.ok(d.getElementById('message').textContent.includes('密码不正确'));
});
