import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { ChatGPTAccount, privateJson, sameState } from './account.mjs';
import { ChatGPTInference } from './inference.mjs';
import { buildReplyPrompt, replySchema, screenshotSchema, screenshotInstructions, validateImages, prohibitedReply } from './prompt.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staticFiles = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const loopback = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value);

function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('请从助手页面提交内容。');
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 28_000_000) throw new Error('上传内容太大，请减少截图。'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function localAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter(row => row?.family === 'IPv4' && !row.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(row.address)).map(row => row.address);
}

export async function createReplyServer({ root = projectRoot, session, account, inference, port = 5418, host = '0.0.0.0' } = {}) {
  const runtime = path.join(root, 'data/private/runtime');
  await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
  await fs.chmod(runtime, 0o700);
  let preferences = {};
  try { preferences = JSON.parse(await fs.readFile(path.join(root, 'data/private/client_preferences.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  account ??= new ChatGPTAccount(path.join(runtime, 'chatgpt-account'), { expectedEmail: preferences.expected_account_email });
  await account.init();
  inference ??= new ChatGPTInference(account);
  session ??= randomBytes(32).toString('base64url');
  const addresses = localAddresses();
  let busy = false, modelCache = null, cacheId = null, cacheTime = 0;
  const outputs = new Map();
  const models = async () => {
    if (!account.view().confirmed || !account.view().sharing) throw new Error('请先在这台 Mac 上登录并确认自己的账号。');
    if (!modelCache || cacheId !== account.view().activeId || Date.now() - cacheTime > 300000) {
      modelCache = await inference.models(); cacheId = account.view().activeId; cacheTime = Date.now();
    }
    return modelCache;
  };
  const server = http.createServer(async (req, res) => {
    const requestStarted=performance.now();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const livePort = server.address().port;
      const allowedHosts = new Set(['localhost', '127.0.0.1', ...addresses].map(ip => `${ip}:${livePort}`));
      if (!allowedHosts.has(req.headers.host)) { json(res, 403, { error: '请使用这台 Mac 给出的助手地址。' }); return; }
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && staticFiles.has(url.pathname)) {
        const [file, mime] = staticFiles.get(url.pathname);
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); res.end(await fs.readFile(path.join(root, 'web', file))); return;
      }
      if (!url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
      if (!sameState(req.headers['x-reply-session'], session)) { json(res, 401, { error: '请从这台 Mac 的二维码或专用链接重新打开助手。' }); return; }
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: '请求来源不匹配。' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        json(res, 200, { account: account.view(), expectedEmail: preferences.expected_account_email ?? null, busy, isMac: loopback(req.socket.remoteAddress), plan: preferences.plan_reported_by_user ?? null }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/phone') {
        if (!loopback(req.socket.remoteAddress)) { json(res, 403, { error: '请在这台 Mac 上查看手机入口。' }); return; }
        const links = addresses.map(ip => `http://${ip}:${livePort}/#${session}`);
        const link = links[0] ?? null;
        json(res, 200, { link, qr: link ? await QRCode.toDataURL(link, { width: 256, margin: 2 }) : null }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/models') { json(res, 200, { models: await models() }); return; }
      if (req.method === 'GET' && url.pathname === '/api/reference') { json(res, 200, JSON.parse(await fs.readFile(path.join(root,'data/private/reference_document.json'),'utf8'))); return; }
      if (req.method !== 'POST') { json(res, 405, { error: '不支持这个操作。' }); return; }
      const input = await body(req);
      if (url.pathname.startsWith('/api/account/')) {
        if (!loopback(req.socket.remoteAddress)) { json(res, 403, { error: '首次登录和账号确认请在这台 Mac 上完成。' }); return; }
        if (busy) { json(res, 409, { error: '请先等当前生成结束，再操作账号。' }); return; }
        if (url.pathname === '/api/account/start') { json(res, 200, await account.startLogin({ newAccount: Boolean(input.newAccount) })); return; }
        if (url.pathname === '/api/account/confirm') { await account.confirmOwner(); json(res, 200, account.view()); return; }
        if (url.pathname === '/api/account/select') { await account.select(input.id); modelCache = null; json(res, 200, account.view()); return; }
        if (url.pathname === '/api/account/signout') { const result = await account.signOut(); modelCache = null; json(res, 200, result); return; }
      }
      if (url.pathname === '/api/task') {
        const prompt = await buildReplyPrompt(root, input);
        json(res, 200, { text: `${prompt.instructions}\n\n${prompt.userText}\n\n本次通过ChatGPT聊天窗口使用：不用软件JSON格式，只把要发的短消息分行给我。需要核对时先问一个关键问题。` }); return;
      }
      if (url.pathname === '/api/feedback') {
        const output = outputs.get(input.outputId);
        if (!output || !['approved', 'unlike', 'too_direct'].includes(input.rating)) throw new Error('请先生成回复，再记录这一组的评价。');
        if (typeof input.finalText !== 'string' || input.finalText.length > 2000 || typeof input.comment !== 'string' || input.comment.length > 1000) throw new Error('评价内容过长。');
        if (input.rating === 'approved' && prohibitedReply(input.finalText.split('\n'))) throw new Error('这句触及已经禁用的表达，不能加入认可样本。');
        const record = { id: randomUUID(), date: new Date().toISOString(), origin: 'user_feedback_in_self_use_app', stage: output.request.stage, instruction: output.request.note, context: output.request.conversation, reply: output.reply.messages, rating: input.rating, final_text: input.finalText, comment: input.comment, not_an_original_user_quote: true };
        const feedbackPath = path.join(runtime, 'feedback.jsonl');
        await fs.appendFile(feedbackPath, JSON.stringify(record) + '\n', { mode: 0o600 }); await fs.chmod(feedbackPath, 0o600);
        json(res, 200, { saved: true }); return;
      }
      if (!['/api/read-image', '/api/generate'].includes(url.pathname)) { json(res, 404, { error: '找不到这个功能。' }); return; }
      if (busy) { json(res, 429, { error: '上一条还在生成，稍等一下。' }); return; }
      busy = true;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 180000);
      const disconnect = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', disconnect);
      try {
        const catalog = await models();
        const requested = catalog.find(row => row.id === input.model);
        const preferred = requested ?? catalog.find(row => /gpt-6\.1-sol/.test(row.id)) ?? catalog.find(row => /gpt-6-astra/.test(row.id)) ?? catalog[0];
        if (!preferred) throw new Error('这个账号暂时没有可用模型。');
        if (input.model && !requested) throw new Error('请选择这个账号实际可用的模型。');
        if (url.pathname === '/api/read-image') {
          const images = validateImages(input.images);
          if (!images.length) throw new Error('请先放入截图。');
          const generated = await inference.generate({ model: preferred.id, instructions: screenshotInstructions, schema: screenshotSchema, input: [{ role: 'user', content: [{ type: 'input_text', text: '请按截图显示的先后顺序转写，标明我和ta，并找出要接的话。' }, ...images] }], signal: controller.signal });
          json(res, 200, generated.value);
        } else {
          const prompt = await buildReplyPrompt(root, input);
          const images=validateImages(input.images??[]);
          const generated = await inference.generate({ model: preferred.id, instructions: prompt.instructions, schema: replySchema, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt.userText },...images] }], signal: controller.signal });
          const reply = generated.value;
          if (!['reply', 'clarify'].includes(reply.status) || !Array.isArray(reply.messages) || reply.messages.some(text => typeof text !== 'string' || text.length > 2000)) throw new Error('回复格式不完整，请重新生成。');
          if (reply.status === 'reply' && !reply.messages.some(text => text.trim())) throw new Error('这次没有生成回复，请重试。');
          if (reply.status === 'clarify' && !reply.question?.trim()) throw new Error('这次需要核对信息，请补充上下文后再试。');
          if (prohibitedReply(reply.messages)) throw new Error('这版触及你的禁用规则，请换一版。');
          if (reply.basis?.kind === 'original') {
            const exact = prompt.result.candidates.find(row => JSON.stringify(row.reply) === JSON.stringify(reply.messages) && reply.basis.sample_ids?.includes(row.id));
            if (!exact) reply.basis = { kind: 'imitation', sample_ids: [] };
          }
          const outputId = randomUUID();
          outputs.set(outputId, { request: { stage: input.stage, note: input.note??'', conversation: String(input.conversation??'').slice(0,12000) }, reply });
          while (outputs.size > 30) outputs.delete(outputs.keys().next().value);
          const elapsedMs=Math.round(performance.now()-requestStarted);
          json(res, 200, { ...reply, outputId, model: preferred.id, elapsedMs, speedTargetMs:10000, speedTargetMet:elapsedMs<=10000 });
        }
      } finally { clearTimeout(timer); res.off('close', disconnect); busy = false; }
    } catch (error) {
      if (!res.writableEnded && !res.destroyed) json(res, 400, { error: error.name === 'AbortError' ? '这次生成已停止，可以再试一次。' : error instanceof SyntaxError ? '提交的内容格式不完整。' : error.message });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const livePort = server.address().port;
  const macLink = `http://127.0.0.1:${livePort}/#${session}`;
  const phoneLinks = addresses.map(ip => `http://${ip}:${livePort}/#${session}`);
  await privateJson(path.join(runtime, 'access.json'), { macLink, phoneLinks, pid: process.pid, port: livePort });
  server.on('close', () => account.finishPending());
  return { server, account, session, macLink, phoneLinks };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const instance = await createReplyServer();
  process.stdout.write(`回复助手已启动：端口 ${instance.server.address().port}。专用链接保存在本机私有目录。\n`);
  const stop = () => { instance.account.finishPending(); instance.server.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
