import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {isWithdrawnMessage,filterReference} from '../scripts/reference-policy.mjs';
test('remove recalled notices without guessing or deleting neighbouring normal text',()=>{
 const input={paragraph_count:4,paragraphs:[{paragraph:37,speaker:'我',text:'正常前句'},{paragraph:38,speaker:'系统提示',text:'你撤回了一条消息'},{paragraph:39,speaker:'ta',text:'正常后句'},{paragraph:40,speaker:'我',text:'撤回了消息就不用说了吗'}]};
 const clean=filterReference(input);assert.deepEqual(clean.paragraphs.map(x=>x.paragraph),[37,39,40]);assert.equal(clean.source_paragraph_count,4);assert.deepEqual(clean.withdrawn_paragraphs_removed,[38]);assert.deepEqual(filterReference(clean),clean);
 assert.equal(isWithdrawnMessage({type:10000,body:'<sysmsg type="revokemsg"><revokemsg/></sysmsg>'}),true);
 assert.equal(isWithdrawnMessage({type:1,body:'我问你为什么撤回了消息'}),false);
});
test('published reference and practice contain none of the confirmed revoked rows',async()=>{
 const reference=JSON.parse(await fs.readFile('data/private/reference_document.json','utf8'));
 assert.equal(reference.paragraph_count,1283);assert.equal(reference.source_paragraph_count,1291);assert.deepEqual(reference.withdrawn_paragraphs_removed,[38,321,468,510,908,960,966,1240]);assert.equal(reference.paragraphs.some(isWithdrawnMessage),false);
 for(const index of [37,39,458,464,1126])assert.ok(reference.paragraphs.some(x=>x.paragraph===index));
 const practice=JSON.parse(await fs.readFile('data/private/practice_scenarios.json','utf8'));assert.equal(practice.original_exchange.rows.some(x=>x.source_index===1395),false);assert.equal(practice.original_exchange.rows.find(x=>x.source_index===1385).speaker,'ta');
});
