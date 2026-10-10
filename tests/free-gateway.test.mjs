import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {proxy} from '../free-gateway/cloud-functions/api/proxy.mjs';
test('free gateway forwards only fixed encrypted routes and never follows redirects or shares the token to another origin',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);let target,options;
 globalThis.fetch=async(url,opts)=>{target=url;options=opts;return Response.json({ciphertext:'fixture'});};
 const context={request:new Request('https://gateway.example/api/vault',{headers:{'x-bonnie-unlock':'a'.repeat(64),cookie:'private-cookie',authorization:'other-secret'}}),env:{BONNIE_SOURCE_SERVICE_TOKEN:'fixture-service'}};
 assert.equal((await proxy(context,'vault')).status,200);assert.equal(target,'https://bonnie-bunny-vault-1011.eagerrobin8.chatgpt.site/vault.json');assert.equal(options.redirect,'manual');assert.equal(options.headers.cookie,undefined);assert.equal(options.headers.authorization,undefined);assert.equal(options.headers['x-bonnie-unlock'],'a'.repeat(64));
 assert.equal((await proxy(context,'anything-else')).status,404);assert.equal((await proxy({...context,env:{}},'vault')).status,503);
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://foreign.example'}});assert.equal((await proxy(context,'vault')).status,502);
 const html=await fs.readFile('free-gateway/public/index.html','utf8');assert.ok(!html.includes('"paragraphs":[{'));assert.ok(!html.includes('chatgpt.site'));assert.ok(html.includes("'/api/vault'"));
});
