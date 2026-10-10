import {validateFeedback,feedbackRules,approvedFeedbackExamples} from './cloud-feedback.mjs';
const encoder=new TextEncoder();
export const VAULT_STATE_KEY='bonnie/password/current-rules.enc.json';
export const HTML_AAD='bonnie-private-html-v1';
export const RULES_AAD='bonnie-private-rules-view-v1';
const STATE_AAD='bonnie-private-cloud-state-v1';
export function fromBase64(value){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
export function toBase64(value){let s='';for(let i=0;i<value.length;i+=8192)s+=String.fromCharCode(...value.subarray(i,i+8192));return btoa(s);}
async function keyFor(env){if(!env.VAULT_ENCRYPTION_KEY)throw new Error('Vault not configured');const bytes=fromBase64(env.VAULT_ENCRYPTION_KEY);if(bytes.length!==32)throw new Error('Vault key invalid');return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);}
export async function encryptVault(text,env,salt,aad){const key=await keyFor(env),iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,encoder.encode(text));return {schema_version:1,kdf:'PBKDF2',hash:'SHA-256',iterations:600000,salt,iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(data)),aad};}
export async function decryptVault(envelope,env,aad){if(envelope.aad!==aad)throw new Error('Envelope context invalid');const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(envelope.iv),additionalData:encoder.encode(aad)},await keyFor(env),fromBase64(envelope.ciphertext));return new TextDecoder().decode(data);}
export async function validSyncToken(request,env){const token=request.headers.get('authorization');if(!env.VAULT_SYNC_TOKEN||!token||token.length>200)return false;const a=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))),b=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode('Bearer '+env.VAULT_SYNC_TOKEN)));let different=0;for(let i=0;i<a.length;i++)different|=a[i]^b[i];return different===0;}
export async function viewerAccess(request,env){
 if(!env.VAULT_ENCRYPTION_KEY||!env.BUCKET)return 503;
 const proof=request.headers.get('x-bonnie-unlock')??'';
 const ipHash=toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(request.headers.get('cf-connecting-ip')??'unknown')))).replaceAll('/','_');
 const name='bonnie/password/attempts/'+ipHash,now=Date.now();
 const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',fromBase64(env.VAULT_ENCRYPTION_KEY)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 for(let n=0;n<5;n++){
  const object=await env.BUCKET.get(name);let counter=object?JSON.parse(await object.text()):{start:now,failures:0};if(now-counter.start>=300000)counter={start:now,failures:0};if(counter.failures>=10)return 429;
  let different=proof.length^expected.length;for(let i=0;i<expected.length;i++)different|=(proof.charCodeAt(i)||0)^expected.charCodeAt(i);if(!different)return 200;
  const saved=await env.BUCKET.put(name,JSON.stringify({start:counter.start,failures:counter.failures+1}),{onlyIf:object?.etag?{etagMatches:object.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'no-store'}});if(saved)return 401;
 }
 return 429;
}
export function validateVaultState(state){if(!state||state.schema_version!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.feedback)||state.revision!==state.feedback.length||state.feedback.length>2000)throw new Error('Invalid state');for(const row of state.feedback){const {created_at,...record}=row;validateFeedback(record);if(created_at!==undefined&&(typeof created_at!=='string'||created_at.length>40))throw new Error('Invalid timestamp');}if(new Set(state.feedback.map(r=>r.id)).size!==state.feedback.length)throw new Error('Duplicate feedback');return state;}
export async function readVaultState(env,fallback){if(!env.BUCKET)throw new Error('Vault storage unavailable');const object=await env.BUCKET.get(VAULT_STATE_KEY);if(!object)return {state:fallback,etag:null};return {state:validateVaultState(JSON.parse(await decryptVault(JSON.parse(await object.text()),env,STATE_AAD))),etag:object.etag};}
export async function saveVaultState(env,state,salt,fallback){validateVaultState(state);for(let n=0;n<5;n++){const current=await readVaultState(env,fallback);if(state.revision<current.state.revision)return {synced:true,revision:current.state.revision,older_snapshot_ignored:true};if(state.revision===current.state.revision&&JSON.stringify(state.feedback)!==JSON.stringify(current.state.feedback))throw new Error('Revision conflict');if(state.revision>current.state.revision&&JSON.stringify(state.feedback.slice(0,current.state.feedback.length))!==JSON.stringify(current.state.feedback))throw new Error('Feedback history conflict');const envelope=await encryptVault(JSON.stringify(state),env,salt,STATE_AAD);const result=await env.BUCKET.put(VAULT_STATE_KEY,JSON.stringify(envelope),{onlyIf:current.etag?{etagMatches:current.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}});if(result)return {synced:true,revision:state.revision};}throw new Error('Concurrent update; retry');}
export function rulesView(state){return {revision:state.revision,ownRules:feedbackRules(state),partnerRules:feedbackRules(state,'practice_partner'),approvedExamples:approvedFeedbackExamples(state)};}
export function vaultHtml(html,state){return html.replace(/window\.REPLY_LOCAL_KNOWLEDGE=([\s\S]*?);<\/script>/,(_,json)=>{const knowledge=JSON.parse(json);Object.assign(knowledge,{cloudRules:feedbackRules(state),cloudPartnerRules:feedbackRules(state,'practice_partner'),cloudApproved:approvedFeedbackExamples(state),cloudRevision:state.revision,cloudSync:false,passwordSite:true,hosted:true});return 'window.REPLY_LOCAL_KNOWLEDGE='+JSON.stringify(knowledge).replaceAll('<','\\u003c')+';</script>';});}
