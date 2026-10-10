# 邦尼兔独立密码网页

网址：https://bonnie-bunny-vault-1011.eagerrobin8.chatgpt.site

无需 GPT 登录；访问密码在用户桌面的独立密码文件中，不进入 GitHub、源代码、网页或备份包。保留完整参考、全文搜索、完整上下文和三个阶段的任务整理。AI 接话与实际对练仍在用户原有 GPT 工作项目中生成。

公开入口不发送明文聊天。服务器验证浏览器的密码证明后才返回 AES-GCM 加密数据，错误尝试有次数限制。密码仅在浏览器派生解密密钥；不传给服务器，不存在本地存储中。点击锁定会清除当前解锁内容。服务器运行时密钥由 Sites secret 管理；R2 中的规则快照也加密保存。

原有 GPT 专用 Site 保持 owner-only，反馈保存后通过固定 HTTPS 端点和独立 secret 同步规则。失败标为 pending；后续 bonnie_get_rules 重试，不能冒称全部同步。密码网页解锁后每分钟更新规则，当前输入和搜索位置保留。

维护：先构建原来的 HTML 和手机 Site，再运行 `node scripts/build-password-site.mjs`。两个 Site 的身份不同，不覆盖原 Site。保存源码、完整 SHA、匹配包，通过 Sites 正常发布；不可把任何 secret 复制进代码或公开仓库。
