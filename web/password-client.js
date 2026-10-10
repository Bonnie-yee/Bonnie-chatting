(()=>{
 const $=id=>document.getElementById(id),decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 let key=null,proof=null,currentRevision=-1,busy=false,polling=false;
 async function fetchEnvelope(path){
  const r=await fetch(path,{cache:'no-store',credentials:'omit',headers:proof?{'x-bonnie-unlock':proof}:{}});
  if(!r.ok)throw new Error(r.status===401?'password':r.status===429?'rate':'network');
  const e=await r.json();
  if(e.schema_version!==1||e.kdf!=='PBKDF2'||e.hash!=='SHA-256'||e.iterations!==600000||decode(e.salt).length!==16||(e.iv&&decode(e.iv).length!==12))throw new Error('format');
  return e;
 }
 async function decrypt(e,aad){if(e.aad!==aad)throw new Error('format');const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(e.iv),additionalData:new TextEncoder().encode(aad)},key,decode(e.ciphertext));return new TextDecoder().decode(data);}
 function clear(){key=null;proof=null;currentRevision=-1;window.REPLY_LOCAL_KNOWLEDGE=undefined;$('private-app').replaceChildren();document.querySelectorAll('[data-vault-style]').forEach(style=>style.remove());$('opened').hidden=true;$('gate').hidden=false;$('password').value='';}
 function mount(html){
  const parsed=new DOMParser().parseFromString(html,'text/html');
  if(!parsed.querySelector('#reference-list')||!parsed.querySelector('main.shell'))throw new Error('content');
  const scripts=[...parsed.querySelectorAll('script')];
  if(scripts.some(script=>script.src))throw new Error('content');
  scripts.forEach(script=>script.remove());
  for(const style of parsed.querySelectorAll('head style')){const copy=document.createElement('style');copy.dataset.vaultStyle='';copy.textContent=style.textContent;document.head.append(copy);}
  $('private-app').replaceChildren(...[...parsed.body.childNodes].map(node=>document.importNode(node,true)));
  // Execute only the authenticated, decrypted application supplied by this server.
  // Private messages are escaped inside the application's JSON payload.
  for(const original of scripts){const script=document.createElement('script');script.textContent=original.textContent;$('private-app').append(script);}
  const data=window.REPLY_LOCAL_KNOWLEDGE;
  if(!data?.reference?.paragraphs?.length||!$('private-app').querySelector('.reference-entry'))throw new Error('content');
  currentRevision=data.cloudRevision;$('refresh-status').textContent='云端规则 · 第 '+currentRevision+' 版';
 }
 async function refresh(){
  if(!key||polling||document.hidden)return;polling=true;
  try{const e=await fetchEnvelope('/rules.enc.json');if(!key)return;const rules=JSON.parse(await decrypt(e,'bonnie-private-rules-view-v1'));if(rules.revision>=currentRevision){window.dispatchEvent(new CustomEvent('bonnie-cloud-rules',{detail:rules}));currentRevision=rules.revision;$('refresh-status').textContent='云端规则 · 第 '+rules.revision+' 版';}}
  catch{$('refresh-status').textContent='暂未收到最新规则，稍后自动重试';}finally{polling=false;}
 }
 $('unlock-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;$('unlock').disabled=true;$('message').textContent='正在打开参考…';
  try{
   if(!crypto.subtle)throw new Error('unsupported');
   const meta=await fetchEnvelope('/vault-meta.json'),password=$('password').value;
   const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
   const raw=await crypto.subtle.deriveBits({name:'PBKDF2',salt:decode(meta.salt),iterations:meta.iterations,hash:meta.hash},material,256);
   key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
   proof=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const envelope=await fetchEnvelope('/vault.json'),html=await decrypt(envelope,'bonnie-private-html-v1');
   mount(html);$('password').value='';$('gate').hidden=true;$('opened').hidden=false;$('message').textContent='';window.scrollTo(0,0);refresh();
  }catch(error){
   clear();$('message').textContent=error.message==='network'?'暂时连接不上，请稍后再试。':error.message==='rate'?'尝试次数过多，请五分钟后再试。':error.message==='unsupported'?'当前浏览器不支持解锁，请用较新的浏览器打开。':error.message==='content'?'参考加载没有完成，请刷新后重新进入。':'密码不正确，请再试一次。';
  }finally{busy=false;$('unlock').disabled=false;}
 });
 $('lock').addEventListener('click',()=>{clear();location.reload();});
 window.addEventListener('pagehide',clear);
 window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
 window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});setInterval(refresh,60000);
})();
