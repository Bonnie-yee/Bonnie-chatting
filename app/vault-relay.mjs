import {readCloudState} from './cloud-feedback.mjs';
export async function relayPasswordSite(env,bucket){
 if(!env.VAULT_SYNC_URL&&!env.VAULT_SYNC_TOKEN)return {status:'not_configured'};
 let httpStatus=null;try{
  if(!env.VAULT_SYNC_TOKEN)throw new Error('Relay unavailable');const target=new URL(env.VAULT_SYNC_URL);if(target.protocol!=='https:'||!target.hostname.endsWith('.chatgpt.site')||target.pathname!=='/internal/snapshot'||target.username||target.password||target.search||target.hash)throw new Error('Relay target invalid');
  const {state}=await readCloudState(bucket),controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
  try{const headers={authorization:'Bearer '+env.VAULT_SYNC_TOKEN,'content-type':'application/json'};if(env.VAULT_SERVICE_TOKEN)headers['OAI-Sites-Authorization']='Bearer '+env.VAULT_SERVICE_TOKEN;const r=await fetch(target,{method:'POST',headers,body:JSON.stringify(state),redirect:'error',signal:controller.signal});httpStatus=r.status;if(!r.ok)throw new Error('Relay failed');const saved=await r.json();if(!saved.synced||saved.revision<state.revision)throw new Error('Relay not verified');return {status:'synced',revision:saved.revision};}finally{clearTimeout(timer);}
 }catch{return {status:'pending',http_status:httpStatus,next_action:'Password website has not received the current rules. Keep cloud/GitHub work, and retry through bonnie_get_rules; do not claim every endpoint is synchronized.'};}
}
