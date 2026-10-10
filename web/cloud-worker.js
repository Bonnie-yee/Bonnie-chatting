// Build embeds the static private app and the shared feedback module here.
/*__FEEDBACK_MODULE__*/
/*__RELAY_MODULE__*/
const ASSETS=/*__ASSETS__*/null;
const BASE=/*__BASE__*/null;
const OWNER_EMAIL=/*__OWNER__*/null;
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store'}});
function owner(request){return !!request.headers.get('oai-authenticated-user-id')&&request.headers.get('oai-authenticated-user-email')?.toLowerCase()===OWNER_EMAIL.toLowerCase();}
function result(id,value){return json({jsonrpc:'2.0',id,result:value});}
function error(id,code,message){return json({jsonrpc:'2.0',id,error:{code,message}});}
function privateHtml(html,state){
  const ownRules=feedbackRules(state),partnerRules=feedbackRules(state,'practice_partner');
  return html.replace(/window\.REPLY_LOCAL_KNOWLEDGE=([\s\S]*?);<\/script>/,(_,data)=>{
    const knowledge=JSON.parse(data);knowledge.cloudRules=ownRules;knowledge.cloudPartnerRules=partnerRules;knowledge.cloudApproved=approvedFeedbackExamples(state);knowledge.cloudRevision=state.revision;knowledge.cloudSync=true;
    return 'window.REPLY_LOCAL_KNOWLEDGE='+JSON.stringify(knowledge).replaceAll('<','\\u003c')+';</script>';
  });
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(url.pathname==='/mcp'){
      if(request.method==='GET')return new Response(null,{status:405,headers:{Allow:'POST'}});
      if(request.method!=='POST')return json({error:'Method not allowed'},405);
      const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'Origin denied'},403);
      if(Number(request.headers.get('content-length')??0)>20000)return json({error:'Request too large'},413);
      let body;try{const text=await request.text();if(text.length>20000)return json({error:'Request too large'},413);body=JSON.parse(text);}catch{return error(null,-32700,'Invalid JSON');}
      if(!body||Array.isArray(body)||body.jsonrpc!=='2.0')return error(body?.id??null,-32600,'Invalid request');
      const id=body.id??null;
      if(body.method==='initialize')return result(id,{protocolVersion:['2025-03-26','2025-06-18','2025-11-25','2026-07-28'].includes(body.params?.protocolVersion)?body.params.protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'bonnie-private-rules',version:'1.0.0'},instructions:'For Bonnie project chats read bonnie_get_rules. After explicit user feedback save it automatically, distinguishing own voice from the fictional practice partner. Continue the returned fixed private GitHub backup using the installed GitHub tools. No manual copy/upload workflow. Never claim a pending backup has completed.'});
      if(body.method==='notifications/initialized')return new Response(null,{status:202});
      if(body.method==='ping')return result(id,{});
      if(body.method==='tools/list')return result(id,{tools:toolsList});
      if(body.method!=='tools/call')return error(id,-32601,'Unknown method');
      if(!owner(request))return json({error:'Owner sign-in required'},401);
      if(!toolsList.some(tool=>tool.name===body.params?.name))return error(id,-32602,'Unknown tool');
      try{const value=await invokeCloudTool(body.params.name,body.params.arguments??{},env.BUCKET,BASE);const sync=await relayPasswordSite(env,env.BUCKET);if(sync.status!=='not_configured')value.password_site_sync=sync;return result(id,{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false});}
      catch(e){return result(id,{content:[{type:'text',text:String(e.message)}],isError:true});}
    }
    if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed'},405);
    if(!owner(request))return json({error:'Owner sign-in required'},401);
    if(url.pathname==='/api/cloud-rules'){
      try{const {state}=await readCloudState(env.BUCKET);return json({revision:state.revision,ownRules:feedbackRules(state),partnerRules:feedbackRules(state,'practice_partner'),approvedExamples:approvedFeedbackExamples(state),githubReceipt:state.github_receipt});}
      catch{return json({error:'Cloud rules temporarily unavailable'},503);}
    }
    const asset=ASSETS[url.pathname];if(!asset)return new Response('Not found',{status:404});
    let body=asset.body;
    if(url.pathname==='/'){
      try{const {state}=await readCloudState(env.BUCKET);body=privateHtml(body,state);}
      catch{body=body.replace('</body>','<p role="status">云端校正暂不可读取，当前显示已发布资料。</p></body>');}
    }
    return new Response(request.method==='HEAD'?null:body,{headers:{'content-type':asset.type,'cache-control':url.pathname==='/'?'private, no-store':'private, max-age=0, must-revalidate','x-content-type-options':'nosniff'}});
  }
};
