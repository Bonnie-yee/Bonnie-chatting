# 邦尼🐰的🐶军师

## 当前版本：只学习我的声音

- 写作样本只取已核对作者的我方文字：1,068 条、459 组；历史 ta 的原句不作为风格示例。61 个场景只把我如何表达、使用条件与动作交给模型。
- 重点重新分析了本人「那你就当是想多了／是无意沾染若有若无的体香」，迁移从刻意解释转到自然印象的思路，不机械更换香水这个词。
- HTML 新增「参考」：逐段保存 ta 版文档全部 1,291 段，支持关键词搜索和单句复制。点「看上下文」打开完整全文并定位命中的那句，可一直向前、向后翻阅，不截断为附近几句。参考保留双方文字，独立于风格库。
- 交互设置只保留「现在的距离」。拉扯、暗示约饭等要求写在随图说明，没有目标、气氛或时间进展菜单。
- 截图与接话合并为一次模型请求，默认不生成长解释，优先使用账号可用的 GPT-6.1 Sol 并采用低推理设置。界面显示完整请求耗时；10 秒是目标，不能对网络与平台排队作硬保证。本机服务的真实账号尚未完成连接，未声称实测达标。
- 桌面「邦尼🐰的🐶军师_GPT项目资料」含项目指令、本人样本、场景、参考全文与维护代码，可放进本人 ChatGPT 项目，以后直接在项目聊天里发图。代码作为维护资料，不要求 GPT 运行本机程序。

当前版本完成完整原文核对、样本过滤、本地检索、手机布局的 HTML 界面，以及独立的 ChatGPT 套餐登录代码。用户已结束本轮对话出题测试。本人 ChatGPT 项目已核对账号、保存指令、上传 8 份资料并完成两次真实文字接话校验；本机独立接口的 OAuth 登录、可用模型、截图识别和在线生成仍需连接后验证；本机服务没有读取或调用现有 Codex 登录，也没有调用付费 API。

## HTML 和手机使用

桌面的 `邦尼🐰的🐶军师.html` 是带本人样本与完整参考的单文件页面，可独立打开。支持预览截图、粘贴对话、选择距离、关键词查询，以及复制接话任务到用户自己的 ChatGPT。目标由随图说明给出。单独打开 HTML 不会自动调用 AI；截图需随接话任务一起附给 ChatGPT。

桌面的 `打开邦尼🐰的🐶军师.command` 启动本机服务并打开独立登录页面。用户在这台 Mac 的官方登录页连接自己的 ChatGPT 账号，返回核对邮箱后，才能取得可用模型和启用生成。手机和 Mac 连同一 Wi-Fi，扫描 Mac 页面里的二维码打开手机界面。本版运行依赖这台 Mac 保持开启，不提供外出使用的远程托管。

```bash
npm ci --ignore-scripts
npm run build:html
npm start
```

账号资料存放在 `data/private/runtime/chatgpt-account/`，与 Codex 登录独立。目标账号和套餐由用户在 `data/private/client_preferences.json` 中确认，邮箱只保存在私有文件里。禁止读取或复用现有 Codex 凭据，不读取环境 API 密钥，也没有付费 API 回退。

生成使用所选账号实际返回的模型，按该账号的套餐限额工作；登录不保证套餐接入可用。本实现依据 [官方独立登录流程](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[模型与流式生成](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) 和 [预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。账号授权仅发生在用户主动点击官方登录入口后；OAuth 回调校验身份、随机 state、nonce、PKCE、签名、有效期和指定邮箱。

截图接话只读取用户选择的截图，识别与生成在一次请求中完成；可见来话会展示以便核对，语音未转成文字时不编造。回复生成前检索本人原话，只加载我方文字与已认可的生成示例，并应用最新禁用规则。参考全文不自动整包送入模型。反馈由用户主动保存，后续使用时结合评价参考。

## 当前样本

- 完整原文：2,459 条文字记录，自己的发言 1,138 条。
- 按用户校正排除 70 条自己的发言，正向库保留 1,068 条。
- 相邻回复整理为 459 组。
- 用户精选：389 条不同的原始发言，重复出现不加权。
- 重点分析：61 组，其中 15 组支持引导主动邀约与确定时间。

## 文件

- `data/private/reply_turns.json`：正向回复及其上文、引用、后续回应和来源。
- `data/private/annotated_cases.json`：重点场景的逐组分析与适用条件。
- `data/private/conversation.json`：已执行排除规则的文字上下文。
- `config/system_prompt.md`：原话优先、最小改写、模仿补充的选择规则。
- `config/author_only_prompt.md`：本人声线、体香机制、作者边界和新界面的核心指令。
- `data/private/author_reply_groups.json`：仅本人发言的全部正向样本。
- `data/private/reference_document.json`：参考全文，仅供查询，不能混作风格样本。
- `scripts/export-project-pack.mjs`：生成桌面的 GPT 项目资料。
- `config/stages.json`：三个关系阶段。
- `config/goals.json`：引导主动约会并落实具体时间的目标。
- `config/exclusions.json`：用户确认的排除与保留范围。
- `analysis/聊天风格与回复机制.md`：风格分析和完整选择逻辑。
- `analysis/60个重点样本.md`：每组原话及其场景、含义和条件。

此私有备份有意包含聊天样本与分析，仅运行凭据、环境密钥和会话目录被 `.gitignore` 排除。用户主动使用在线识别或生成时，仅将当前输入与相关样本发送给自己授权的 ChatGPT 接口；完整原文不整包上传，也不替用户发送微信消息。单文件 HTML 不发送网络模型请求。

## 本地检索

使用已安装的 Node.js 即可，无额外软件依赖。

```bash
node scripts/search.mjs --stage new --query '他说今天很累，快没电了'
node scripts/search.mjs --stage familiar --emotion playful --query '他又用提问来接我的问题'
node scripts/search.mjs --stage familiar --goal concrete_invitation --availability '周五晚上,周日下午' --query '他说改天一起吃饭，我想让他主动定具体时间'
```

这里的空闲时间只是命令示例，实际使用时替换为自己的真实安排。加入 `--prompt` 可生成含当前对话、候选原话和适用条件的模型输入文本；这个选项不会发送网络请求。

检索用中文字符组合和已标注的场景提示排序。它提供候选，最终还需要结合完整上下文、目标和阶段判断。原文中后续发生的回应用于分析，生成输入不会使用这些事后信息。

## 校验

```bash
node --test tests/corpus.test.mjs
```

校验覆盖来源完整性、发言归属、重复标记、禁用片段、保留的斗嘴、阶段适配、情绪核对、未来回应隔离和主动邀约目标。

## 测试反馈

发最近几条双方对话，能说明关系阶段和本次目标时一起说明。目标可以是自然接话、轻轻逗他、表达好感，或引导他主动约到具体时间。涉及约会时，提供真实空闲窗口。

每次记录最终采用的文字，以及哪里像、哪里生硬、哪里过头、哪里没接住。来源引用保留，方便追查和修改。

最新邀约目标从普通日常话题开始：对方未邀请时先给能接出邀请的信号；对方真正邀请后，才进入日期和钟点的确认。

用户认可早一轮的想念试探和邀约落实；随后认可咖啡半价与热心市民、记住口味却说顺手的两个新场景。共同偷懒的收尾被否定；修订为「你这是没走累／还是没跟我待够啊」后，用户评价为「非常好」。认可的生成示例保存在 `data/private/approved_generated_examples.json`，保持助手生成来源，与本人原话库分开。

## 尚待实际验证

用户自己的账号是否允许 ChatGPT 套餐接入，以及成功完成识别和生成的结果，需要本人登录后核实。本机测试覆盖账号隔离、错误账号拒绝、登录身份校验、生成前的账号确认、流式失败处理、原文排除、阶段适配和邀约推进；测试中的身份与生成结果为显式模拟，不代表真实账号已经连通。


## 本人 GPT 项目与私有备份

[打开邦尼🐰的🐶军师](https://chatgpt.com/g/g-p-6ac9c47bbb348191a347feea9ab2d54c/project)，位于本人账号，已创建专属项目。

[GitHub 私有备份](https://github.com/Bonnie-yee/jieyiju-personal-assistant) 包含可恢复的源码、本人样本、参考 Word 和项目资料，不保存运行凭据。

当前 GPT 项目会读取已上传的本人风格、正向样本、场景与最新校正。已验证一次实际修正：删掉第二阶段会讲破特殊在意的补句。生成结果不是已训练成与本人完全相同的模型，也不能保证每次正好符合本人想法或始终在 10 秒内完成；未认可的校验生成句不进正向样本。


## 私有备份与恢复

本仓库属于 Bonnie-yee，必须保持 Private。它保存代码、本人风格资料、全部参考、分析与反馈、独立 HTML 和 GPT 项目导入包。没有包含登录令牌、环境密钥、微信数据库或数据库解密信息。原始文字源只保留复核必需的正文、作者、时间与原始索引，并将对方姓名标为 ta；数据库标识已去掉。

- `artifacts/邦尼🐰的🐶军师.html`：可直接打开的独立 HTML。
- `gpt_project/`：可导入本人 ChatGPT 项目的文件。
- `source_documents/reference_ta.docx`：可编辑的参考 Word 原文。
- `source_documents/text_only_records_ta.json`：完整文字来源，供作者复核与重新生成资料。
- `BACKUP_MANIFEST.json`：备份文件的 SHA-256 校验清单。

恢复时下载或克隆仓库，然后运行 `npm ci --ignore-scripts`。直接使用独立 HTML，或运行 `npm run build:html` 重新输出桌面 HTML。运行 `node scripts/prepare-v2-data.mjs` 可从仓库内的文字与 Word 源重新准备资料；运行 `node scripts/export-project-pack.mjs` 重新输出桌面 GPT 项目资料。`scripts/open.command` 可启动本机助手。需要在线生成功能时重新登录本人账号，备份不会自动带入登录状态。

历史分析保留用于追溯；当前生成以 `config/author_only_prompt.md`、`data/private/author_*`、本人认可和最新排除规则为准。真实接口速度尚未实测，不将模拟测试耗时当作十秒实绩。


