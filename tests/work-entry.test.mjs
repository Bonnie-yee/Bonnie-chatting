import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
test('work preview is only an independent external link and leaves relationship navigation and knowledge intact',async()=>{
  const files=[process.env.BONNIE_HTML_PATH||'dist/standalone.html','mobile-site/dist/index.html'];
  for(const file of files){
    const html=await fs.readFile(file,'utf8'),dom=new JSDOM(html,{runScripts:'outside-only'}),d=dom.window.document;
    const a=d.getElementById('work-preview-link');assert.ok(a);const url=new URL(a.href);assert.equal(url.origin,'https://bunny-work-preview-1012.eagerrobin8.chatgpt.site');assert.equal(url.search,'');assert.equal(url.hash,'');assert.equal(a.target,'_blank');assert.ok(a.rel.includes('noopener'));assert.ok(a.rel.includes('noreferrer'));
    assert.deepEqual([...d.querySelectorAll('.view-tabs button')].map(b=>b.dataset.view),['reply','reference','practice']);assert.equal(d.querySelectorAll('iframe').length,0);
    assert.ok(!html.includes('work-purpose')&&!html.includes('commonSystemPrefix')&&!html.includes('private work draft'));
    const knowledge=JSON.parse(html.match(/window\.REPLY_LOCAL_KNOWLEDGE=([\s\S]*?);<\/script>/)[1]);assert.equal(knowledge.reference.paragraph_count,1283);assert.equal(knowledge.ta_style_sample_count,0);assert.ok(!('workPolicy' in knowledge));
    dom.window.close();
  }
});
