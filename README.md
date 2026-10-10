# Bonnie🐰chatting

邦尼🐰的🐶军师：私人聊天参考、接话与练习。GitHub 仓库必须保持 Private。

## 使用入口

- [本人 GPT 项目：Bonnie🐰Chatting](https://chatgpt.com/g/g-p-6ac9c47bbb348191a347feea9ab2d54c/project)
- [GPT-6.1 Sol 工作入口](https://chatgpt.com/g/g-p-6ac9c47bbb348191a347feea9ab2d54c/c/6aca54fc-055c-83ea-9f75-89ed88e7e989)
- [私人手机网页](https://bonnie-bunny-adviser-1010.eagerrobin8.chatgpt.site)：参考、全文关键词搜索、完整上下文和练习入口。不依赖 Mac 开机或同一 Wi-Fi。
- [GitHub 私有备份](https://github.com/Bonnie-yee/Bonnie-chatting)

用户账号已核对为本人 Plus。原 GPT 项目的全部 11 份来源、聊天和 3,494 字符说明保留；按用户明确确认从仅限项目记忆改为默认记忆，实际创建 GPT-6.1 Sol 工作对话并读到了全部来源和第 5 版云端校正。普通 Chat 旧对话继续保留，新的工作入口才使用 6.1 Sol，不声称旧 Chat 已全部改变执行模式。

## 当前资料

本人原文正向库 1,068 条、459 组，61 个场景，4 个早期明确认可的生成示例。ta 的话只做上下文。新反馈另外保存，获赞的虚构 ta 不进入本人样本。

参考原 Word 1,291 段；显示版移除 8 条确认撤回的系统占位，保留 1,283 段及原段号。原 Word 为复核来源保留。搜索命中后能向前后连续翻阅完整全文；不猜测或删除邻近正常消息。体香机制、三个阶段、主动邀约与具体时间、用户排除片段、成语迁移、连续练习和反馈校正均包含在当前规则里。

## 自动同步

私人 Site 已有云端持久规则库和 MCP 工具，插件名「邦尼🐰的🐶军师」。本人 GPT 已实际保存 5 条反馈并提交到 GitHub sync/current_rules.json；云端网页读取同一份规则。

1. 新工作对话读取 bonnie_get_rules。
2. 明确反馈调用 bonnie_record_feedback，本人回复与虚构对手偏好分开。
3. GPT 使用本人已连接的 GitHub 插件更新唯一固定路径，读回核对，再报告真实提交；失败保留待同步。
4. GitHub Actions 自动构建私人仓库中的 HTML 备份。它不把私人聊天发布到 GitHub Pages。
5. Mac 离线或合盖睡眠时云端继续；Mac 醒来联网后，本机同步器读取私有仓库的 HTML 自动补同步。磁盘离线时无法被远程实时改写。

GitHub 回执来自已验证工具结果，不等于构建已完成。构建/发布、GPT 调用、手机实际缓存分别核验。外部服务耗时不保证每次完整答案都在 10 秒内。

## 构建与恢复

```sh
npm ci --ignore-scripts
node scripts/build-html.mjs
node scripts/build-mobile-site.mjs
node scripts/export-project-pack.mjs
npm test
```

app/cloud-feedback.mjs 是云端反馈与严格归属规则；web/cloud-worker.js 是私人 Worker/MCP；mobile-site/.openai/hosting.json 保存已有 Site 身份；config/cloud_sync_prompt.md 是同步流程；.github/workflows/feedback-sync.yml 自动构建；scripts/sync-desktop.mjs 是本机补同步器。

data/private/、gpt_project/、source_documents/、artifacts/ 只在私人仓库备份。运行登录目录、密钥、微信数据库、Site 写凭据和 Codex 凭据均不进入备份。原有本机独立登录程序保留；其 OAuth 尚未连接，不挪用当前 Codex 登录，不增加付费模型 API 回退。

上传的项目文件是提供来源，不等于运行其代码或训练模型权重。当前长期校正通过专用插件读取；模型只能在实际上下文里尽量模仿，不声称已完全复制本人。
