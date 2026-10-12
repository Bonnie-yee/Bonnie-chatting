import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const repository='/Users/huangbaoyi/Desktop/jieyiju-personal-assistant';
const expected='https://github.com/Bonnie-yee/Bonnie-chatting.git';
const env={...process.env,GIT_TERMINAL_PROMPT:'0'};
try{
 const remote=(await run('/usr/bin/git',['remote','get-url','origin'],{cwd:repository,env})).stdout.trim();if(remote!==expected)throw new Error('Unexpected repository');
 await run('/usr/bin/git',['fetch','origin','main'],{cwd:repository,env,timeout:60000,maxBuffer:200000});
 const sha=(await run('/usr/bin/git',['rev-parse','origin/main'],{cwd:repository,env})).stdout.trim();
 const {stdout:html}=await run('/usr/bin/git',['show','origin/main:artifacts/Bunny Chatting.html'],{cwd:repository,env,maxBuffer:3000000});
 if(!html.includes('window.REPLY_LOCAL_KNOWLEDGE=')||!html.includes('<title>Bunny Chatting</title>'))throw new Error('Unexpected artifact');
 const output=path.join(os.homedir(),'Desktop','Bunny Chatting.html');
 const temporary=output+'.sync-tmp';await fs.writeFile(temporary,html,{mode:0o600});await fs.rename(temporary,output);
 console.log(JSON.stringify({status:'synced',commit:sha,updated_at:new Date().toISOString()}));
}catch(error){console.log(JSON.stringify({status:'pending',reason:error.message==='Unexpected repository'?'repository_mismatch':'offline_or_backup_unavailable',updated_at:new Date().toISOString()}));process.exitCode=1;}
