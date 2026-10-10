/*__FEEDBACK_MODULE__*/
/*__VAULT_MODULE__*/
const LOCK_PAGE=/*__LOCK_PAGE__*/null;
const PRIVATE_HTML=/*__PRIVATE_HTML__*/null;
const FALLBACK_STATE=/*__FALLBACK_STATE__*/null;
const SALT=/*__SALT__*/null;
const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'SAMEORIGIN','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' blob:; img-src data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"};
function response(value,status=200,type='application/json; charset=utf-8'){return new Response(type.startsWith('application/json')?JSON.stringify(value):value,{status,headers:{...headers,'content-type':type}});}
export default {async fetch(request,env){
  const url=new URL(request.url);
  if(url.pathname==='/internal/snapshot'){
    if(request.method!=='POST')return response({error:'Method not allowed'},405);
    if(!await validSyncToken(request,env))return response({error:'Unauthorized'},401);
    if(Number(request.headers.get('content-length')??0)>2_000_000)return response({error:'Request too large'},413);
    try{const text=await request.text();if(new TextEncoder().encode(text).length>2_000_000)return response({error:'Request too large'},413);return response(await saveVaultState(env,JSON.parse(text),SALT,FALLBACK_STATE));}catch{return response({error:'Snapshot was not stored; retry current revision'},409);}
  }
  if(!['GET','HEAD'].includes(request.method))return response({error:'Method not allowed'},405);
  if(url.pathname==='/')return response(request.method==='HEAD'?'':LOCK_PAGE,200,'text/html; charset=utf-8');
  if(url.pathname==='/vault-meta.json')return response({schema_version:1,kdf:'PBKDF2',hash:'SHA-256',iterations:600000,salt:SALT});
  if(url.pathname==='/vault.json'||url.pathname==='/rules.enc.json'){
    try{const status=await viewerAccess(request,env);if(status!==200)return response({error:status===429?'Too many attempts; retry in five minutes':'Private content locked'},status);const {state}=await readVaultState(env,FALLBACK_STATE);const full=url.pathname==='/vault.json';const payload=full?vaultHtml(PRIVATE_HTML,state):JSON.stringify(rulesView(state));const envelope=await encryptVault(payload,env,SALT,full?HTML_AAD:RULES_AAD);return response(request.method==='HEAD'?null:envelope);}catch{return response({error:'Private content temporarily unavailable'},503);}
  }
  if(url.pathname==='/robots.txt')return response('User-agent: *\nDisallow: /\n',200,'text/plain; charset=utf-8');
  return response({error:'Not found'},404);
}};
