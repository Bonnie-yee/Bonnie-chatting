import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async relative => JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
const [html, css, js, policy, stages, approved, userExamples, cases, preferences, reference] = await Promise.all([
  fs.readFile(path.join(root, 'web/index.html'), 'utf8'), fs.readFile(path.join(root, 'web/style.css'), 'utf8'), fs.readFile(path.join(root, 'web/app.js'), 'utf8'),
  fs.readFile(path.join(root, 'config/author_only_prompt.md'), 'utf8'), readJson('config/stages.json'), readJson('data/private/approved_generated_examples.json'), readJson('data/private/user_provided_style_examples.json'), readJson('data/private/annotated_cases.json'), readJson('data/private/client_preferences.json'), readJson('data/private/reference_document.json')
]);
const cleanCases=cases.map(({id,reply,scene,condition,allowed_stages,retrieval_hints})=>({id,origin:'original_user',writer:'我',my_messages:reply,scene_summary:scene,usage_condition:condition,allowed_stages,retrieval_hints}));
const ownApproved=approved.map(({id,origin,stage,reply,style_move,usage_conditions})=>({id,origin,stage,writer_target:'我',my_messages:reply,style_move,usage_conditions,not_an_original_user_quote:true}));
const ownProvided=userExamples.map(({id,origin,reply,clarification})=>({id,origin,writer:'我',my_messages:reply,clarification}));
const practice=await readJson('data/private/practice_scenarios.json');
const practicePolicy=await fs.readFile(path.join(root,'config/practice_prompt.md'),'utf8');
const knowledge={policy,stages,approved:ownApproved,userExamples:ownProvided,cases:cleanCases,reference,practice,practicePolicy,projectUrl:preferences.work_chat_url||preferences.project_url,practiceChatUrl:preferences.practice_work_chat_url||preferences.practice_chat_url,referenceChatUrl:preferences.reference_work_chat_url||preferences.reference_chat_url,expectedEmail:preferences.expected_account_email,ta_style_sample_count:0};
try { const cloud=await readJson('sync/current_rules.json'); const {feedbackRules,approvedFeedbackExamples}=await import('../app/cloud-feedback.mjs'); knowledge.cloudRules=feedbackRules(cloud); knowledge.cloudPartnerRules=feedbackRules(cloud,'practice_partner'); knowledge.cloudRevision=cloud.revision; knowledge.cloudApproved=approvedFeedbackExamples(cloud); } catch(error) { if(error.code!=='ENOENT')throw error; }
const data = JSON.stringify(knowledge).replaceAll('刘子睿', 'ta').replaceAll('<', '\\u003c');
const standalone = html.replace('<link rel="stylesheet" href="/style.css">', `<style>${css}</style>`).replace('<script src="/app.js" defer></script>', `<script>window.REPLY_LOCAL_KNOWLEDGE=${data};</script>\n<script>${js}</script>`);
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(os.homedir(), 'Desktop', 'Bunny Chatting.html');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, standalone, { mode: 0o600 }); await fs.chmod(output, 0o600);
await fs.mkdir(path.join(root, 'dist'), { recursive: true });
await fs.writeFile(path.join(root,'dist/standalone.html'),standalone,{mode:0o600});
for (const [name, text] of [['index.html',html],['style.css',css],['app.js',js]]) await fs.writeFile(path.join(root, 'dist', name), text);
console.log(JSON.stringify({ html: output, original_cases: cleanCases.length, approved_generated_examples: approved.length, reference_paragraphs: reference.paragraph_count, ta_style_samples: 0, bytes: Buffer.byteLength(standalone) }));
