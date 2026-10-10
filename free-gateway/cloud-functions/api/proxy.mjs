const SOURCE='https://bonnie-bunny-vault-1011.eagerrobin8.chatgpt.site';
const paths={meta:'/vault-meta.json',vault:'/vault.json',rules:'/rules.enc.json'};
// This gateway contains no chat records or decryption key. The source still
// verifies the viewer's password proof before returning encrypted content.
export async function proxy(context,kind){
 const path=paths[kind];if(!path)return new Response('Not found',{status:404});
 if(!['GET','HEAD'].includes(context.request.method))return new Response('Method not allowed',{status:405});
 const token=context.env?.BONNIE_SOURCE_SERVICE_TOKEN;
 if(!token)return Response.json({error:'Website gateway is not configured'},{status:503});
 const headers={'OAI-Sites-Authorization':'Bearer '+token};
 const proof=context.request.headers.get('x-bonnie-unlock');if(proof&&/^[a-f0-9]{64}$/.test(proof))headers['x-bonnie-unlock']=proof;
 try{const result=await fetch(SOURCE+path,{method:context.request.method,headers,redirect:'manual'});if(result.status>=300&&result.status<400)return Response.json({error:'Source redirect rejected'},{status:502});return new Response(result.body,{status:result.status,headers:{'content-type':result.headers.get('content-type')||'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});}catch{return Response.json({error:'Source temporarily unavailable'},{status:502});}
}
