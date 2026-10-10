(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const knowledge = window.REPLY_LOCAL_KNOWLEDGE ?? null;
  const live = !knowledge || !knowledge.hosted && /^https?:$/.test(location.protocol) && location.hash.length > 20;
  let session = location.hash.slice(1);
  if (live) {
    try { session ||= sessionStorage.getItem('reply_session') ?? ''; if (session) sessionStorage.setItem('reply_session', session); } catch {}
    if (location.hash) history.replaceState(null, '', location.pathname);
  }
  let stage = 'familiar', images = [], busy = false, status = null, output = null, abort = null, phoneLink = null, modelAccount = null, reference = null, referenceLimit = 120, referenceFocus = null;
  let practiceMode='duel',practiceLibrary=knowledge?.practice??null,practicePolicy=knowledge?.practicePolicy??'',practiceProjectUrl=knowledge?.practiceChatUrl||knowledge?.projectUrl||'https://chatgpt.com/g/g-p-6ac9c47bbb348191a347feea9ab2d54c/project';
  const hints = { new: '先接住话题，轻松有趣，慢慢建立熟悉感。', familiar: '含蓄一点，接住话题，给他留个接话的口子。', close: '亲近要有上下文，回应投入，也保留你的语气。' };
  function notice(text, error = false) { $('notice').hidden = !text; $('notice').textContent = text; $('notice').classList.toggle('error', error); }
  async function api(route, data, signal) {
    const response = await fetch(`/api/${route}`, { method: data === undefined ? 'GET' : 'POST', headers: { 'X-Reply-Session': session, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? '操作没有完成，请重试。');
    return result;
  }
  function requestData() {
    return {conversation:$('conversation').value.trim(),stage,note:$('note').value.trim(),model:$('model').value,images};
  }
  function setBusy(value, label = '认真想一下…') {
    busy = value;
    $('generate').disabled = value || live && !(status?.account.confirmed && status?.account.sharing);
    $('generate').textContent = value ? label : live ? '帮我接一句 ↗' : '复制任务，去我的 ChatGPT ↗';
    $('regenerate').disabled = value;
    $('stop').hidden = !value;
    for (const id of ['login', 'confirm-owner', 'signout', 'model']) $(id).disabled = value;
    $('model').disabled = value || !live || !status?.account.confirmed;
    for (const id of ['conversation','screenshots','clear-images','note','copy-task']) $(id).disabled = value;
    document.querySelectorAll('[data-stage],[data-rating]').forEach(button => { button.disabled = value; });
  }
  async function copyText(text, fallbackElement = null) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
    const temporary = document.createElement('textarea');
    temporary.value = text; temporary.style.position = 'fixed'; temporary.style.top = '-1000px';
    document.body.append(temporary); temporary.focus(); temporary.select(); temporary.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy'); temporary.remove();
    if (!copied && fallbackElement) { fallbackElement.hidden = false; fallbackElement.value = text; fallbackElement.focus(); fallbackElement.select(); fallbackElement.setSelectionRange(0, text.length); }
    return copied;
  }
  async function refreshStatus() {
    if (!live) return;
    status = await api('status');
    const account = status.account;
    $('account-toggle').textContent = account.confirmed && account.sharing ? '自己的账号已连接' : account.connected ? '核对登录账号' : '连接我的账号';
    $('plan-label').textContent = status.plan ? `${status.plan} · 使用套餐额度` : 'ChatGPT';
    $('account-email').textContent = account.email ? `当前连接：${account.email}` : status.expectedEmail ? `请登录：${status.expectedEmail}` : '请登录自己的 ChatGPT 账号';
    $('login').hidden = !status.isMac;
    $('confirm-owner').hidden = !status.isMac || !account.connected || account.confirmed || account.pending;
    $('signout').hidden = !status.isMac || !account.connected;
    $('account-description').textContent = !status.isMac && !account.confirmed ? '先在这台 Mac 的页面上连接并核对自己的账号，手机这里会自动更新。' : account.pending ? '官方登录页已打开，请选择自己的账号并完成授权。' : account.confirmed ? '这个助手使用自己的独立登录，生成会计入 ChatGPT 套餐额度。' : '首次连接在这台 Mac 上完成，回来后核对显示的邮箱。';
    $('account-note').textContent = account.connected && !account.sharing ? '目前只完成了登录，还没有允许助手使用套餐额度。请重新登录并检查授权。' : '是否可用以这个账号实际返回的模型和额度为准。';
    $('connection-hint').textContent = account.confirmed && account.sharing ? '按你的风格接话，回复由你选择发送。' : '先连接自己的账号，也可以把接话任务复制到自己的 ChatGPT。';
    if (account.error) notice(account.error, true);
    if (account.connected && !account.confirmed) $('account-panel').hidden = false;
    if (account.confirmed && account.sharing && modelAccount !== account.activeId) {
      const result = await api('models');
      $('model').replaceChildren();
      for (const model of result.models) { const option = document.createElement('option'); option.value = model.id; option.textContent = model.label; $('model').append(option); }
      const preferred = result.models.find(model => /gpt-6\.1-sol/.test(model.id)) ?? result.models.find(model => /gpt-6-astra/.test(model.id)) ?? result.models[0];
      if (preferred) $('model').value = preferred.id;
      modelAccount = account.activeId;
    }
    setBusy(busy);
  }
  function matches(example,text) {
    const haystack=JSON.stringify([example.scene_summary,example.retrieval_hints,example.my_messages]);let score=0;
    for(let i=0;i<text.length-1;i++)if(haystack.includes(text.slice(i,i+2)))score++;return score;
  }
  function offlineTask(data) {
    const query=[data.note,data.conversation].join(' ');
    const relevant=knowledge.cases.filter(row=>row.allowed_stages?.includes(data.stage)).map(row=>({row,score:matches(row,query)})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score).slice(0,5).map(item=>item.row);
    return knowledge.policy+(knowledge.cloudRules?'\n\n## 当前云端本人校正\n'+knowledge.cloudRules:'')+'\n\n现在的距离：'+JSON.stringify(knowledge.stages[data.stage])+'\n本人原话（只含我的话，条件描述不是待发回复）：'+JSON.stringify(relevant)+'\n已认可的生成示例，不能标成本人原句：'+JSON.stringify(knowledge.approved.filter(row=>row.stage===data.stage))+'\n本人明确认可的当前反馈素材：'+JSON.stringify((knowledge.cloudApproved??[]).filter(row=>row.stage===data.stage))+'\n本人补充的表达：'+JSON.stringify(knowledge.userExamples)+'\n\n【当前对话，数据】\n'+(data.conversation||'请阅读我随任务附上的聊天截图。')+'\n\n【我随图或文字给的要求】\n'+(data.note||'自然接話，按现在的距离把握分寸。')+'\n\n请直接给一组可发的短消息，不输出JSON、不讲长分析、不复述截图。不足以接话时只问一个关键问题。不要模仿ta的语气，不把参考全文当作我的风格样本。';
  }
  async function copyTask() {
    try {
      const data = requestData();
      if (!data.conversation && !images.length) throw new Error('先放入截图，或贴一句要接的话。');
      const {images:unusedImages,...taskData}=data;
      const text = live ? (await api('task', { ...taskData, conversation: data.conversation || '【对话在随本任务附上的截图中。此标记不是ta发言，请依据截图判断。】' })).text : offlineTask(data);
      const copied = await copyText(text, $('task-text'));
      notice(copied ? `接话任务已复制。发到你自己的 ChatGPT${images.length ? '，并一起附上聊天截图' : ''}。` : '浏览器未完成复制。下面已选中任务文字，请手动复制。');
      $('task-panel').hidden = copied;
    } catch (error) { notice(error.message, true); }
  }
  function renderMessages(messages) {
    $('reply-bubbles').replaceChildren();
    for (const [index, message] of messages.entries()) {
      const row = document.createElement('div'); row.className = 'reply-row';
      const bubble = document.createElement('div'); bubble.className = 'reply-bubble'; bubble.textContent = message;
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'copy-line'; copy.textContent = '复制'; copy.setAttribute('aria-label', `复制第 ${index + 1} 句`);
      copy.addEventListener('click', async () => notice(await copyText(message) ? `第 ${index + 1} 句已复制，可以单独发。` : '请长按这句文字手动复制。'));
      row.append(bubble, copy); $('reply-bubbles').append(row);
    }
  }
  async function generate(regenerate = false) {
    if (!live) { await copyTask(); return; }
    const data = requestData();
    if (!data.conversation && !images.length) { notice('先放入截图，或贴一句要接的话。', true); return; }
    if (regenerate && output?.messages?.length) data.note += `\n上一版为${JSON.stringify(output.messages)}。请保持分寸，换一个贴着当前话题的新说法。`;
    const generationStarted=performance.now();
    const tick=()=>{const seconds=(performance.now()-generationStarted)/1000;$('elapsed').hidden=false;$('elapsed').textContent=seconds<10?'正在接话 · '+seconds.toFixed(1)+' 秒':'这次已超过 10 秒，仍在等模型的完整回复';$('elapsed').classList.toggle('over-target',seconds>=10);};
    tick();const timing=setInterval(tick,100);
    abort = new AbortController(); setBusy(true); notice('正在按你的语气接话…');
    try {
      output = await api('generate', data, abort.signal);
      if (output.status === 'clarify') { notice(output.question); $('result-panel').hidden = true; return; }
      renderMessages(output.messages);
      $('reply-edit').value = output.messages.join('\n'); $('reply-edit').hidden = true;
      $('reply-bubbles').hidden = false; $('edit-reply').textContent = '我改一下';
      $('reply-reason').textContent = output.reason||'默认直接给回复；想知道为什么这样接，可以在随图说明中问。'; $('result-panel').hidden = false;
      $('incoming-preview').textContent=output.incoming?'接的是 ta 这句话：'+output.incoming:'';$('incoming-preview').hidden=!output.incoming;
      const total=(performance.now()-generationStarted)/1000;$('elapsed').textContent='本次完整用时 '+total.toFixed(1)+' 秒'+(total>10?' · 超过 10 秒目标':'');$('elapsed').classList.toggle('over-target',total>10);
      $('feedback-comment').value = ''; notice('');
      $('result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) { notice(error.name === 'AbortError' ? '这次已停止，内容还在，可以重新生成。' : error.message, true); }
    finally { clearInterval(timing); abort = null; setBusy(false); }
  }
  $('account-toggle').addEventListener('click', () => { $('account-panel').hidden = !$('account-panel').hidden; });
  $('login').addEventListener('click', async () => {
    const popup = window.open('about:blank', '_blank');
    try {
      const result = await api('account/start', { newAccount: false });
      if (result.authUrl) { if (popup) popup.location.href = result.authUrl; else location.href = result.authUrl; }
      else { popup?.close(); notice('已经有一次登录在进行，请先完成官方登录页。'); }
      await refreshStatus();
    } catch (error) { popup?.close(); notice(error.message, true); }
  });
  $('confirm-owner').addEventListener('click', async () => { try { await api('account/confirm', {}); await refreshStatus(); notice('自己的账号已确认，可以开始接话了。'); } catch (error) { notice(error.message, true); } });
  $('signout').addEventListener('click', async () => { try { const result = await api('account/signout', {}); modelAccount = null; await refreshStatus(); notice(result.remoteRevoked ? '这个助手的账号已断开。' : '本机已断开；远端撤销未确认，可以到 ChatGPT 设置中断开助手。'); } catch (error) { notice(error.message, true); } });
  $('screenshots').addEventListener('change', async event => {
    try {
      const files = [...event.target.files];
      if (files.length > 3 || files.some(file => file.size > 6_000_000)) throw new Error('最多 3 张截图，每张不超过 6 MB。');
      if (files.some(file => !['image/png','image/jpeg','image/webp'].includes(file.type))) throw new Error('请选 PNG、JPG 或 WebP 截图。');
      images = await Promise.all(files.map(file => new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); })));
      $('image-previews').replaceChildren();
      for (const [i, image] of images.entries()) { const preview = document.createElement('img'); preview.src = image; preview.alt = `聊天截图 ${i+1}`; $('image-previews').append(preview); }
      $('image-tools').hidden = !images.length; $('recognition-note').hidden = true; notice('');
      if (!live && images.length) notice('本地 HTML 可以预览截图。复制接话任务后，把截图一起发到自己的 ChatGPT。');
    } catch (error) { notice(error.message, true); }
  });
  $('clear-images').addEventListener('click', () => { images = []; $('screenshots').value = ''; $('image-previews').replaceChildren(); $('image-tools').hidden = true; $('recognition-note').hidden = true; });
  document.querySelectorAll('[data-stage]').forEach(button => button.addEventListener('click', () => { stage = button.dataset.stage; document.querySelectorAll('[data-stage]').forEach(item => { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)); }); $('stage-hint').textContent = hints[stage]; }));
  $('generate').addEventListener('click', () => generate()); $('regenerate').addEventListener('click', () => generate(true));
  $('stop').addEventListener('click', () => abort?.abort()); $('copy-task').addEventListener('click', copyTask);
  $('edit-reply').addEventListener('click', () => { const edit = $('reply-edit'); edit.hidden = !edit.hidden; $('reply-bubbles').hidden = !edit.hidden; $('edit-reply').textContent = edit.hidden ? '我改一下' : '保留修改'; if (!edit.hidden) edit.focus(); else renderMessages(edit.value.split('\n').filter(Boolean)); });
  $('copy-reply').addEventListener('click', async () => { const ok = await copyText($('reply-edit').value, $('reply-edit')); notice(ok ? '已复制，回微信粘贴就好。' : '文字已选中，请手动复制。'); });
  document.querySelectorAll('[data-rating]').forEach(button => button.addEventListener('click', async () => { try { await api('feedback', { outputId: output?.outputId, rating: button.dataset.rating, finalText: $('reply-edit').value, comment: $('feedback-comment').value }); notice('记下了，会结合这次的上下文影响后续回复。'); } catch (error) { notice(error.message, true); } }));
  $('copy-phone').addEventListener('click', async () => { notice(await copyText(phoneLink) ? '手机入口已复制。' : '请用手机扫一扫二维码。'); });
  function highlightText(container,text,query) {
    if(!query){container.textContent=text;return;}
    const lower=text.toLowerCase(),needle=query.toLowerCase();let position=0,found;
    while((found=lower.indexOf(needle,position))>=0){container.append(document.createTextNode(text.slice(position,found)));const mark=document.createElement('mark');mark.textContent=text.slice(found,found+query.length);container.append(mark);position=found+query.length;}
    container.append(document.createTextNode(text.slice(position)));
  }
  function renderReference(resetScroll=true) {
    if(!reference)return;
    const query=$('reference-search').value.trim();
    let entries=reference.paragraphs.filter(row=>row.text.trim());
    if(referenceFocus===null&&query)entries=entries.filter(row=>row.text.normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').toLowerCase()));
    const list=$('reference-list'),scroll=list.scrollTop;list.replaceChildren();
    $('reference-count').textContent=referenceFocus!==null?'完整上下文 · 可向前后翻阅全文':query?'找到 '+entries.length+' 处':'全文已收录 · '+entries.length+' 段内容';
    $('reference-all').hidden=referenceFocus===null;
    const visibleEntries=referenceFocus===null?entries.slice(0,referenceLimit):entries;
    for(const row of visibleEntries) {
      const entry=document.createElement('article');entry.className='reference-entry';entry.classList.toggle('mine',row.speaker==='我'||row.quote_speaker==='我');entry.classList.toggle('quoted',Boolean(row.quote_speaker));entry.classList.toggle('reference-focused',row.paragraph===referenceFocus);
      entry.dataset.paragraph=String(row.paragraph);
      const head=document.createElement('div');head.className='reference-entry-head';
      const who=document.createElement('span');who.textContent=[row.time,row.speaker??(row.quote_speaker?'引用 '+row.quote_speaker:'原文')].filter(Boolean).join(' · ');
      const actions=document.createElement('div');actions.className='reference-entry-actions';
      const copy=document.createElement('button');copy.type='button';copy.textContent='复制';copy.setAttribute('aria-label','复制参考第 '+row.paragraph+' 段');copy.addEventListener('click',async()=>notice(await copyText(row.body)?'这句已复制。':'请选中文字手动复制。'));actions.append(copy);
      if(query&&referenceFocus===null){const context=document.createElement('button');context.type='button';context.textContent='看上下文';context.addEventListener('click',()=>{referenceFocus=row.paragraph;referenceLimit=120;renderReference();});actions.append(context);}
      head.append(who,actions);const text=document.createElement('p');text.className='reference-entry-body';highlightText(text,row.body,query);entry.append(head,text);list.append(entry);
    }
    if(!entries.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='没有找到，换一个词试试。';list.append(empty);}
    $('reference-more').hidden=referenceFocus!==null||entries.length<=referenceLimit;
    if(referenceFocus!==null&&resetScroll)list.querySelector('.reference-focused')?.scrollIntoView({block:'center',behavior:'auto'});
    else if(!resetScroll)list.scrollTop=scroll;
    else list.scrollTop=0;
  }
  function activateView(view) {
    document.body.dataset.view=view;
    document.querySelectorAll('[data-view]').forEach(item=>{const selected=item.dataset.view===view;item.classList.toggle('selected',selected);item.setAttribute('aria-pressed',String(selected));});
  }
  activateView(['reference','practice'].includes(location.hash.slice(1))?location.hash.slice(1):knowledge?.passwordSite?'reference':'reply');
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>activateView(button.dataset.view)));
  let referenceTimer;
  $('reference-search').addEventListener('input',()=>{clearTimeout(referenceTimer);referenceTimer=setTimeout(()=>{referenceFocus=null;referenceLimit=120;renderReference();},60);});
  $('reference-more').addEventListener('click',()=>{referenceLimit+=120;renderReference(false);});
  $('reference-all').addEventListener('click',()=>{referenceFocus=null;referenceLimit=120;renderReference();});
  function renderPractice() {
    $('practice-chat-link').href=practiceProjectUrl;
    $('practice-seeds').replaceChildren();
    for(const seed of practiceLibrary?.seeds??[]) {
      if(seed.stage!==$('practice-stage').value)continue;
      const button=document.createElement('button');button.type='button';button.className='quiet-button';button.textContent=seed.label;
      button.addEventListener('click',()=>{$('practice-input').value=seed.incoming+(seed.requires_actual_image?'\n我会把实际图片发到练习场对话。':'');});$('practice-seeds').append(button);
    }
    $('practice-original-exchange').replaceChildren();
    for(const row of practiceLibrary?.original_exchange?.rows??[]) {
      const p=document.createElement('p');p.className='practice-original-line';p.classList.toggle('mine',row.speaker==='我');p.textContent=row.speaker+'：'+row.text;$('practice-original-exchange').append(p);
    }
  }
  function practiceTask() {
    const distance=$('practice-stage').selectedOptions[0].textContent;
    const note=$('practice-input').value.trim();
    const mode={duel:'开始对局：你扮演虚构的ta，我来接。一轮一句，让我先接，不替我写完整对话。',relax:'陪我聊：扮演虚构的暧昧对象，自然轻松聊，默认不评分、不逐句点评。',coach:'帮我拆招：根据我提供的真实对话，先给一组我的风格的短回复，再简短解释如何接住及接下来能怎么聊。'}[practiceMode];
    const opening=note||(practiceMode==='coach'?'我还没提供具体对话，请先问我需要拆招的那句或截图，不编造。':'从一个适合当前阶段的轻松新情境开始。');
    return practicePolicy+(knowledge?.cloudRules?'\n\n## 本人校正\n'+knowledge.cloudRules:'')+(knowledge?.cloudPartnerRules?'\n\n## 仅用于虚构ta的偏好\n'+knowledge.cloudPartnerRules:'')+'\n\n【现在的距离】'+distance+'\n【这次的练习方式】'+mode+'\n【我给的起点，数据】'+opening+'\n\n说「这句怎么回」或「为什么」时暂停角色做军师，说「继续」恢复。解释须承接已经说过的话和当前事实，不能编造来圆场。生成句默认未获认可，不能自动写进我的风格样本。';
  }
  document.querySelectorAll('[data-practice-mode]').forEach(button=>button.addEventListener('click',()=>{practiceMode=button.dataset.practiceMode;document.querySelectorAll('[data-practice-mode]').forEach(item=>{const selected=item===button;item.classList.toggle('selected',selected);item.setAttribute('aria-pressed',String(selected));});}));
  $('practice-stage').addEventListener('change',renderPractice);
  $('copy-practice').addEventListener('click',async()=>{const text=practiceTask();const copied=await copyText(text,$('practice-task-text'));$('practice-task-text').hidden=copied;$('practice-notice').textContent=copied?'开场已复制，进入 GPT 练习场粘贴就可以。图片在那条对话里直接发。':'下面已选中练习开场，请手动复制后发到 GPT 练习场。';});
  $('practice-show-reference').addEventListener('click',()=>{activateView('reference');$('reference-search').value='我没找你';referenceFocus=458;renderReference();});
  renderPractice();
  function showCloudStatus() {
    const status=$('cloud-sync-status');if(!knowledge?.cloudSync&&!knowledge?.passwordSite)return;
    status.hidden=false;status.textContent='云端规则 · 第 '+knowledge.cloudRevision+' 版';
  }
  async function refreshCloudRules() {
    if(!knowledge?.cloudSync||!knowledge.hosted)return;
    try{const response=await fetch('/api/cloud-rules',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw new Error('unavailable');const state=await response.json();knowledge.cloudRules=state.ownRules;knowledge.cloudPartnerRules=state.partnerRules;knowledge.cloudRevision=state.revision;knowledge.cloudApproved=state.approvedExamples??[];showCloudStatus();}
    catch{$('cloud-sync-status').hidden=false;$('cloud-sync-status').textContent='当前显示已加载规则，联网后自动刷新。';}
  }
  window.addEventListener('focus',refreshCloudRules);
  window.addEventListener('bonnie-cloud-rules',event=>{if(!knowledge?.passwordSite)return;const state=event.detail;if(!state||!Number.isSafeInteger(state.revision)||state.revision<knowledge.cloudRevision)return;knowledge.cloudRules=state.ownRules;knowledge.cloudPartnerRules=state.partnerRules;knowledge.cloudApproved=state.approvedExamples??[];knowledge.cloudRevision=state.revision;showCloudStatus();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCloudRules();});
  async function init() {
    showCloudStatus();if(knowledge?.cloudSync&&knowledge.hosted)setInterval(()=>{if(!document.hidden)refreshCloudRules();},60000);
    if(knowledge?.reference){reference=knowledge.reference;renderReference();}
    else if(live){try{reference=await api('reference');renderReference();}catch(error){$('reference-count').textContent=error.message;}}
    if (!live) {
      $('account-toggle').textContent = '使用我的 ChatGPT'; $('account-panel').hidden = Boolean(knowledge.hosted);
      $('account-description').textContent = '这是可独立打开的 HTML。先复制接话任务，再发到你自己的 ChatGPT；需要截图时一起附上。';
      $('account-email').textContent = knowledge.expectedEmail ? `使用账号：${knowledge.expectedEmail}` : '';
      $('login').hidden = true; $('model').disabled = true; $('account-note').textContent = 'HTML 本身不调用 AI，也不会使用当前 Codex 的登录。';
      $('connection-hint').textContent = '规则和参考样本已带进任务文本，生成由你自己的 ChatGPT 完成。';
      setBusy(false); return;
    }
    try {
      const practice=await api('practice').catch(()=>null);if(practice){practiceLibrary=practice.library;practicePolicy=practice.policy;practiceProjectUrl=practice.chatUrl||practice.projectUrl||practiceProjectUrl;renderPractice();}
      await refreshStatus();
      if (status.isMac) { const phone = await api('phone'); phoneLink = phone.link; if (phone.qr) { $('phone-qr').src = phone.qr; $('phone-panel').hidden = false; } }
      setInterval(() => refreshStatus().catch(error => notice(error.message, true)), 4000);
    } catch (error) { notice(error.message, true); setBusy(false); }
  }
  init();
})();
