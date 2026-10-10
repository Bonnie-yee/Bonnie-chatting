import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

export async function privateJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temporary, file);
  await fs.chmod(file, 0o600);
}

async function optionalJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function validateIdentity(token, clientId, nonce, keySet = jwks) {
  const { payload } = await jwtVerify(token, keySet, { issuer: ISSUER, audience: clientId, algorithms: ['RS256'], requiredClaims: ['iss', 'sub', 'aud', 'exp', 'nonce'], clockTolerance: 5 });
  if (!payload.sub || payload.nonce !== nonce) throw new Error('登录身份核对失败，请重新登录。');
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId) throw new Error('登录授权对象不匹配。');
  return { subject: payload.sub, issuer: payload.iss, email: payload.email ?? null };
}

export function sameState(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class ChatGPTAccount {
  constructor(directory, { fetchImpl = fetch, verifyIdentity = validateIdentity, expectedEmail = null } = {}) {
    // This app never loads Codex/CLI credentials or environment API keys.
    this.directory = directory;
    this.fetch = fetchImpl;
    this.verifyIdentity = verifyIdentity;
    this.expectedEmail = expectedEmail?.trim().toLowerCase() ?? null;
    this.pending = null;
    this.refreshing = null;
    this.lastError = null;
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.directory, 0o700);
    const hostPath = path.join(this.directory, 'host.json');
    this.host = await optionalJson(hostPath);
    if (!this.host) {
      this.host = { ext_agent_host_id: `urn:uuid:${randomUUID()}` };
      await privateJson(hostPath, this.host);
    }
    this.active = await optionalJson(path.join(this.directory, 'active.json'));
    this.records = await optionalJson(path.join(this.directory, 'registrations.json')) ?? [];
    this.credentials = this.active ? await optionalJson(this.credentialPath(this.active.id)) : null;
  }

  credentialPath(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid local registration ID');
    return path.join(this.directory, `connection-${id}.json`);
  }

  view() {
    const record = this.records.find(row => row.id === this.active?.id);
    return {
      connected: Boolean(this.credentials?.access_token),
      sharing: Boolean(this.credentials?.access_token && this.credentials.scopes?.includes('chatgpt.tokens.use.direct')),
      confirmed: Boolean(this.credentials?.access_token && this.active?.confirmed),
      email: record?.email ?? null,
      registrations: this.records.map(({ id, email }) => ({ id, email })),
      activeId: this.active?.id ?? null,
      pending: Boolean(this.pending),
      error: this.lastError
    };
  }

  async select(id) {
    if (this.pending) throw new Error('请先完成正在进行的登录。');
    if (!this.records.some(row => row.id === id)) throw new Error('找不到这个助手账号。');
    this.credentials = await optionalJson(this.credentialPath(id));
    this.active = { id, confirmed: false };
    await privateJson(path.join(this.directory, 'active.json'), this.active);
  }

  async confirmOwner() {
    if (!this.credentials || this.pending) throw new Error('请先完成自己账号的登录。');
    if (this.expectedEmail && this.credentials.email?.toLowerCase() !== this.expectedEmail) throw new Error('当前登录的邮箱不是你指定的账号。');
    this.active = { id: this.credentials.id, confirmed: true };
    await privateJson(path.join(this.directory, 'active.json'), this.active);
  }

  async startLogin({ newAccount = false } = {}) {
    if (this.pending) return { pending: true };
    this.lastError = null;
    const selected = newAccount ? null : this.records.find(row => row.id === this.active?.id);
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const listener = http.createServer((req, res) => this.callback(req, res).catch(() => {
      this.lastError ||= '登录未完成，请重新尝试。';
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(this.lastError);
      this.finishPending();
    }));
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
    const redirect = `http://127.0.0.1:${listener.address().port}/auth/callback`;
    const timer = setTimeout(() => { this.lastError = '登录等待已结束，请重新登录。'; this.finishPending(); }, 5 * 60 * 1000);
    timer.unref();
    this.pending = { state, nonce, verifier, listener, redirect, selected, timer };
    const url = new URL(`${ISSUER}/api/accounts/authorize`);
    const fields = {
      client_id: selected?.client_id ?? 'dynamic_agent_client',
      ext_agent_host_id: this.host.ext_agent_host_id,
      response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: RESOURCE,
      state, nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url')
    };
    if (!selected) fields.agent_name_hint = '暧昧回复助手';
    // No ID-token hint: the user must see and choose the account, especially on a shared Mac.
    for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
    return { authUrl: url.href, pending: true };
  }

  finishPending() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.listener.close(); this.pending = null; }
  }

  async callback(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/auth/callback') { res.writeHead(404); res.end(); return; }
    const pending = this.pending;
    if (!pending || pending.consumed || !sameState(url.searchParams.get('state'), pending.state)) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('这次登录请求无效，请从助手重新登录。'); return;
    }
    pending.consumed = true;
    if (url.searchParams.has('error')) throw new Error('Authorization denied');
    const clientId = url.searchParams.get('client_id') ?? pending.selected?.client_id;
    if (!clientId || clientId === 'dynamic_agent_client' || clientId.length > 256 || !url.searchParams.get('code')) throw new Error('Incomplete registration');
    if (pending.selected && clientId !== pending.selected.client_id) throw new Error('Registration mismatch');
    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code', client_id: clientId, code: url.searchParams.get('code'),
      code_verifier: pending.verifier, redirect_uri: pending.redirect, resource: RESOURCE
    });
    if (!tokens.id_token || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('Incomplete token response');
    const identity = await this.verifyIdentity(tokens.id_token, clientId, pending.nonce);
    if (this.expectedEmail && identity.email?.toLowerCase() !== this.expectedEmail) {
      this.lastError = '登录回来的邮箱不是你指定的账号。请重新登录自己的账号。';
      throw new Error('Wrong account');
    }
    if (pending.selected && (identity.subject !== pending.selected.subject || identity.issuer !== pending.selected.issuer)) throw new Error('Account identity changed');
    const id = createHash('sha256').update(`${identity.issuer}\0${identity.subject}\0${clientId}`).digest('hex');
    const record = { id, client_id: clientId, ...identity };
    const credentials = {
      ...record, ext_agent_host_id: this.host.ext_agent_host_id,
      access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? null, id_token: tokens.id_token,
      scopes: String(tokens.scope ?? '').split(' ').filter(Boolean), expires_at: Date.now() + tokens.expires_in * 1000
    };
    await privateJson(this.credentialPath(id), credentials);
    this.records = this.records.filter(row => row.id !== id).concat(record);
    await privateJson(path.join(this.directory, 'registrations.json'), this.records);
    this.active = { id, confirmed: false }; await privateJson(path.join(this.directory, 'active.json'), this.active);
    this.credentials = credentials;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>登录完成</title><p>已连接你选择的 ChatGPT 账号。请回到回复助手，确认显示的是你自己的账号。</p>');
    this.finishPending();
  }

  async tokenRequest(fields) {
    const response = await this.fetch(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('登录或续期失败，请重新登录自己的 ChatGPT 账号。');
    return response.json();
  }

  async accessToken() {
    if (!this.view().sharing || !this.view().confirmed) throw new Error('请先登录并确认这是你自己的 ChatGPT 账号，允许助手使用套餐额度。');
    if (this.expectedEmail && this.credentials.email?.toLowerCase() !== this.expectedEmail) throw new Error('当前登录的邮箱不是你指定的账号。');
    if (this.credentials.expires_at > Date.now() + 60000) return this.credentials.access_token;
    if (!this.refreshing) this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
    await this.refreshing;
    return this.credentials.access_token;
  }

  async refresh() {
    const saved = this.credentials;
    if (!saved?.refresh_token) throw new Error('登录已到期，请重新登录。');
    const tokens = await this.tokenRequest({ grant_type: 'refresh_token', client_id: saved.client_id, refresh_token: saved.refresh_token, resource: RESOURCE });
    if (!tokens.access_token || !Number.isFinite(tokens.expires_in)) throw new Error('登录续期未完成，请重新登录。');
    const updated = { ...saved, access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? saved.refresh_token, id_token: tokens.id_token ?? saved.id_token, scopes: tokens.scope ? tokens.scope.split(' ').filter(Boolean) : saved.scopes, expires_at: Date.now() + tokens.expires_in * 1000 };
    await privateJson(this.credentialPath(saved.id), updated);
    if (this.active?.id === saved.id) this.credentials = updated;
  }

  async signOut() {
    this.finishPending();
    if (this.refreshing) await this.refreshing.catch(() => {});
    const credentials = this.credentials;
    this.credentials = null;
    if (!credentials) return { remoteRevoked: true };
    let remoteRevoked = false;
    try {
      const discovery = await this.fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) });
      const metadata = await discovery.json();
      const endpoint = new URL(metadata.revocation_endpoint);
      if (endpoint.origin !== ISSUER || endpoint.protocol !== 'https:') throw new Error('Invalid revocation endpoint');
      const response = await this.fetch(endpoint.href, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: credentials.refresh_token, token_type_hint: 'refresh_token', client_id: credentials.client_id }), signal: AbortSignal.timeout(10000) });
      remoteRevoked = response.ok;
    } catch { /* Local sign-out still removes only this app's own credentials. */ }
    await fs.rm(this.credentialPath(credentials.id), { force: true });
    return { remoteRevoked };
  }
}
