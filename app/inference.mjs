export function inferenceError(code) {
  if (code === 'subscription_sharing_usage_limit_exceeded') return '你的套餐额度暂时用完了，可以到 ChatGPT 查看重置时间。';
  if (code === 'subscription_sharing_usage_unavailable') return '这个账号目前未开放套餐接入，请到 ChatGPT 检查助手授权。';
  if (code === 'invalid_api_key' || code === 'invalid_token') return '登录已到期，请重新登录你自己的账号。';
  return '这次生成没有完成，请稍后再试。';
}

export async function consumeResponse(response) {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(inferenceError(error.error?.code));
  }
  const decoder = new TextDecoder();
  let buffer = '', text = '', completed = false, result = null;
  const parse = block => {
    const payload = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!payload || payload === '[DONE]') return;
    const event = JSON.parse(payload);
    if (event.type === 'response.output_text.delta') text += event.delta ?? '';
    if (event.type === 'response.failed' || event.type === 'error') throw new Error(inferenceError(event.response?.error?.code ?? event.code));
    if (event.type === 'response.incomplete') throw new Error('这次回复没有生成完整，请重试。');
    if (event.type === 'response.completed') { completed = true; result = event.response; }
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) { parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
    if (buffer.length > 2_000_000 || text.length > 100_000) throw new Error('返回内容异常，请重新尝试。');
  }
  buffer += decoder.decode();
  if (buffer.trim()) parse(buffer);
  if (!completed) throw new Error('连接中断，这次生成未完成。');
  if (!text) text = (result?.output ?? []).flatMap(item => item.content ?? []).filter(part => part.type === 'output_text').map(part => part.text).join('');
  if (!text.trim()) throw new Error('没有收到完整回复，请重试。');
  return { text, usage: result?.usage ?? null };
}

export class ChatGPTInference {
  constructor(account, fetchImpl = fetch) { this.account = account; this.fetch = fetchImpl; }
  async models() {
    const token = await this.account.accessToken();
    const response = await this.fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('还不能取得这个账号的可用模型，请检查登录和套餐授权。');
    const catalog = await response.json();
    if (!Array.isArray(catalog.models)) throw new Error('账号返回的模型列表格式不适用于套餐接入。');
    return catalog.models.filter(model => model.visibility === 'list').map(model => ({ id: model.slug, label: model.display_name ?? model.slug, inputModalities: model.input_modalities ?? null }));
  }
  async generate({ model, instructions, input, schema, signal }) {
    const token = await this.account.accessToken();
    const response = await this.fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({ model, instructions, input, store: false, stream: true, ...(/^gpt-[56]/.test(model) ? { reasoning: { effort: 'low' } } : {}), text: { format: { type: 'json_schema', name: 'reply_assistant_output', strict: true, schema } } })
    });
    const result = await consumeResponse(response);
    return { ...result, value: JSON.parse(result.text) };
  }
}
