import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(os.homedir(),'Desktop','邦尼🐰的🐶军师_GPT项目资料');
const readJson=async name=>JSON.parse(await fs.readFile(path.join(root,'data/private',name),'utf8'));
await fs.mkdir(output,{recursive:true,mode:0o700});
const [core,groups,cases,approved,provided,reference]=await Promise.all(['author_style_core.json','author_reply_groups.json','annotated_cases.json','approved_generated_examples.json','user_provided_style_examples.json','reference_document.json'].map(readJson));
const instruction=`${core.policy}\n\n## 在这个 GPT 项目里使用\n\n这个项目的每条聊天都代表用户与某一个人的当前对话。不同人开不同聊天，不能混用他们的姓名、偏好、约会安排或对我的感情。风格从「01_我的风格.md」「02_我的回复样本.jsonl」「03_我的场景与认可.md」学习；「04_参考.txt」只查情境和出处，维护代码只供维护，不作为说话风格。\n\n用户会直接丢截图或最近几句，随图写现在的阶段、想拉扯还是暗示约饭等要求。不要求她填目标菜单；未明确阶段时按实际线索保守处理，不虚构已经熟悉或喜欢。只给一组最好用的短消息，通常1—3条。不要在日常接话时重新总结所有资料、逐文件阅读全部代码或主动联网搜索。需要时只取少量相关的本人样本。只在用户问为什么时解释。以10秒为速度目标，不能以无意义套话、未完成片段或等待提示冒充答案，也不能对外部服务时延做绝对承诺。\n`;
const style=await fs.readFile(path.join(root,'analysis/体香表达的感觉与迁移.md'),'utf8');
const sceneText=cases.map(row=>`### ${row.scene}\n来源：本人原记录，索引 ${row.source_indices.join('、')}。建议适用阶段：${row.allowed_stages.join('、')}，不是原关系阶段的断言。\n本人原话：\n${row.reply.map(text=>'> '+text).join('\n')}\n表达动作：${row.move}\n使用条件：${row.condition}\n`).join('\n');
const approvedText=approved.map(row=>`### 已认可生成示例 ${row.id}\n来源：助手生成，用户明确认可；不是本人原句。阶段：${row.stage}。\n${row.reply.map(text=>'> '+text).join('\n')}\n动作：${row.style_move}\n`).join('\n');
const directText=provided.map(row=>`### 本人当前补充 ${row.id}\n${row.reply.map(text=>'> '+text).join('\n')}\n${row.clarification}\n`).join('\n');
const files={
  '00_项目指令.txt':instruction,
  '01_我的风格.md':core.policy+'\n\n'+style,
  '02_我的回复样本.jsonl':groups.map(row=>JSON.stringify(row)).join('\n')+'\n',
  '03_我的场景与认可.md':'# 我的场景与认可\n\n只包含我的发言。条件描述不是待发回复，对方措辞不属于我的风格。\n\n'+sceneText+'\n## 明确认可的生成示例\n\n'+approvedText+'\n## 本人补充\n\n'+directText,
  '04_参考.txt':'参考\n\n以下逐段保留「新聊天记录_ta版.docx」全部文字，含重复与作者不明的摘录。只供查阅与理解情境。ta、引用ta、系统提示和作者不明内容不进入我的风格；被排除的冲突与竞争片段也不从这里重新学习。\n\n'+reference.paragraphs.map(row=>row.text).join('\n\n')+'\n'
};
let code='# 软件代码：仅供维护\n\n日常接话不要读取或执行这份代码。只从本人样本和风格指令学习声音。代码中的测试句、对方来话与反例不是我的风格样本。真实账号凭据不包含在本文件里。\n';
for(const directory of ['app','web','scripts','tests','config'])for(const name of (await fs.readdir(path.join(root,directory))).sort()){
  if(!/\.(mjs|js|html|css|json|md|command)$/.test(name))continue;
  const relative=directory+'/'+name;code+=`\n\n## ${relative}\n\n\`\`\`text\n${await fs.readFile(path.join(root,relative),'utf8')}\n\`\`\`\n`;
}
files['05_软件代码仅供维护.md']=code;
files['README_怎么放进GPT项目.md']=`# 邦尼🐰的🐶军师：GPT 项目导入\n\n使用自己的 ChatGPT 账号，创建一个新的私有项目，名字可用「邦尼🐰的🐶军师」。\n\n1. 打开项目的指令设置，把「00_项目指令.txt」全文粘贴为项目指令。\n2. 向项目 Sources / 添加文件上传 01、02、03、04；05 是完整维护代码，可一并上传，日常接话不需要读取它。\n3. 在这个项目里为不同男生分别开聊天，直接发截图或最近几句，顺带说阶段和要求，如「第二阶段，含蓄地暗示约饭」。之后同一个人的情况在对应聊天里继续。\n4. 想要快答时选择账号可用的即时模式；不要求模型每次重读所有大文件或讲长解释。10秒是目标，不是外部服务的硬保证。\n\n项目能共享上传文件和指令；上传代码是提供维护资料，不等于把本机服务装在项目里执行。HTML 界面和本机程序继续在浏览器与 Mac 上运行。\n\n本人正向文字 ${core.user_message_count} 条，分 ${groups.length} 组；逐场景分析 ${cases.length} 组；已认可生成示例 ${approved.length} 组；参考全文 ${reference.paragraph_count} 段。ta 的发言不作为风格样本。\n\n资料依据：[OpenAI 官方 Projects 说明](https://learn.chatgpt.com/docs/projects)。后续有新的校正时，更新项目指令或重新上传对应资料。不要把资料放进其他人的账号，也不要共享这个私有项目。\n`;
for(const [name,text]of Object.entries(files)){const file=path.join(output,name);await fs.writeFile(file,text,{mode:0o600});await fs.chmod(file,0o600);}
console.log(JSON.stringify({project_pack:output,files:Object.keys(files),author_groups:groups.length,author_messages:core.user_message_count,reference_paragraphs:reference.paragraph_count}));
