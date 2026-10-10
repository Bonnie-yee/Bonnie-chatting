import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
globalThis.crypto??=webcrypto;
const source=await fs.readFile('mobile-site/dist/server/index.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const call=(method,params,headers={})=>new Request('https://test.chatgpt.site/mcp',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('MCP discovery contains no private samples and data calls require owner identity',async()=>{
 const response=await worker.fetch(call('tools/list',{}),{});const body=await response.json();assert.equal(body.result.tools.length,4);assert.ok(!JSON.stringify(body).includes('体香'));
 assert.equal((await worker.fetch(call('tools/call',{name:'bonnie_get_rules',arguments:{}}),{})).status,401);
 assert.equal((await worker.fetch(new Request('https://test.chatgpt.site/'),{})).status,401);
 assert.equal((await worker.fetch(call('tools/call',{name:'bonnie_get_rules',arguments:{}},{'oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'wrong@example.org'}),{})).status,401);
});
test('Worker rejects cross-origin posts and unsupported methods rather than serving static HTML',async()=>{
 assert.equal((await worker.fetch(call('tools/list',{}, {origin:'https://foreign.example'}),{})).status,403);
 assert.equal((await worker.fetch(new Request('https://test.chatgpt.site/mcp'),{})).status,405);
 const response=await worker.fetch(call('unknown',{}),{});assert.equal((await response.json()).error.code,-32601);
});
test('signed-in owner receives full clean reference and current cloud revision',async()=>{
 const env={BUCKET:{get:async()=>null}};
 const response=await worker.fetch(new Request('https://test.chatgpt.site/',{headers:{'oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'huangbaoyi03@gmail.com'}}),env);assert.equal(response.status,200);
 const html=await response.text();const data=JSON.parse(html.match(/window\.REPLY_LOCAL_KNOWLEDGE=([\s\S]*?);<\/script>/)[1]);assert.equal(data.cloudSync,true);assert.equal(data.cloudRevision,0);assert.equal(data.reference.paragraphs.length,1283);assert.equal(data.practice.original_exchange.rows.some(x=>x.source_index===1395),false);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
});
