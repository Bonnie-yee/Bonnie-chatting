import {pbkdf2Sync,createHash,webcrypto} from 'node:crypto';
import fs from 'node:fs';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdout.write('Ready for private service verification JSON on stdin (input is hidden).\n');
let input='';process.stdin.resume();process.stdin.on('data',chunk=>{input+=chunk;if(input.includes('\n')){process.stdin.pause();verify(JSON.parse(input)).then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});}});
async function verify({serviceToken}){
const origin='https://bonnie-bunny-vault-1011.eagerrobin8.chatgpt.site';
const service={'OAI-Sites-Authorization':'Bearer '+serviceToken};
const gate=await fetch(origin,{headers:service,redirect:'error'}),html=await gate.text();
if(!gate.ok||!html.includes('id="unlock-form"'))throw new Error('Gate unavailable: '+gate.status);
if(html.includes('体香')||html.includes('huangbaoyi03@gmail.com'))throw new Error('Gate leaks private content');
const locked=await fetch(origin+'/vault.json',{headers:service,redirect:'error'});if(locked.status!==401)throw new Error('Private read is not password locked');
const meta=await(await fetch(origin+'/vault-meta.json',{headers:service,redirect:'error'})).json();
const password=process.env.BONNIE_TEST_PASSWORD;if(password===undefined)throw new Error('Set the exact verification password in BONNIE_TEST_PASSWORD');
const raw=pbkdf2Sync(password,Buffer.from(meta.salt,'base64'),meta.iterations,32,'sha256');const proof=createHash('sha256').update(raw).digest('hex');
const response=await fetch(origin+'/vault.json',{headers:{...service,'x-bonnie-unlock':proof},redirect:'error'});if(!response.ok)throw new Error('Correct password not accepted: '+response.status);const envelope=await response.json();
const key=await webcrypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);const data=await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:new TextEncoder().encode(envelope.aad)},key,Buffer.from(envelope.ciphertext,'base64'));
const app=new TextDecoder().decode(data),knowledge=JSON.parse(app.match(/window\.REPLY_LOCAL_KNOWLEDGE=([\s\S]*?);<\/script>/)[1]);
const result={date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),url:origin,gate_status:gate.status,service_access_without_password_status:locked.status,password_accepted:true,title_bunny:app.includes('<title>Bunny Chatting</title>'),reference_paragraphs:knowledge.reference.paragraphs.length,cloud_revision:knowledge.cloudRevision,approved_examples:knowledge.cloudApproved.length,plaintext_before_unlock:false};
fs.writeFileSync('analysis/独立密码网页核验.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
