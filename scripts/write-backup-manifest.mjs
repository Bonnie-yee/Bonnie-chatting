import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const names=(await run('git',['ls-files','-z'],{maxBuffer:2_000_000})).stdout.split('\0').filter(Boolean).filter(name=>name!=='BACKUP_MANIFEST.json'&&!/(^|\/)(runtime|node_modules|\.sites-runtime)(\/|$)|(^|\/)\.env|\.(pem|key|log|zip|tgz)$/.test(name));
const files=[];
for(const name of names.sort()){const content=await fs.readFile(name);files.push({path:name,bytes:content.length,sha256:crypto.createHash('sha256').update(content).digest('hex')});}
const state=JSON.parse(await fs.readFile('sync/current_rules.json','utf8'));
await fs.writeFile('BACKUP_MANIFEST.json',JSON.stringify({display_name:'Bonnie🐰chatting',visibility:'private',cloud_revision:state.revision,files},null,2)+'\n');
