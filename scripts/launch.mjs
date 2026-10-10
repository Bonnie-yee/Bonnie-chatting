import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createReplyServer } from '../app/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let link;
try {
  const saved = JSON.parse(await fs.readFile(path.join(root,'data/private/runtime/access.json'),'utf8'));
  const result = await fetch(`http://127.0.0.1:${saved.port}/api/status`, { headers: { 'X-Reply-Session': new URL(saved.macLink).hash.slice(1) }, signal: AbortSignal.timeout(1000) });
  if (result.ok) link = saved.macLink;
} catch {}
if (!link) {
  const app = await createReplyServer(); link = app.macLink;
  process.on('SIGINT', () => app.server.close()); process.on('SIGTERM', () => app.server.close());
  console.log('邦尼🐰的🐶军师已启动。手机和这台 Mac 连同一个 Wi-Fi 后，可扫描页面里的二维码。关闭此窗口会停止服务。');
}
spawn('open', [link], { stdio: 'ignore' }).unref();
