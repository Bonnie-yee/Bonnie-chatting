import test from 'node:test';
import assert from 'node:assert/strict';
import {isBackupPath} from '../scripts/backup-policy.mjs';

test('backups reject access passwords, credentials, runtime state and nested archives while retaining valid private sources',()=>{
  for(const file of ['gpt_project/邦尼兔独立网页_访问密码.txt','Bunny Chatting_访问密码.txt','access-password.txt','config/credentials.json','data/private/runtime/access.json','.env.local','private.key','gpt_project/old.zip','site.tgz','previews/bunny-dual-branch/web/index.html'])
    assert.equal(isBackupPath(file),false,file);
  for(const file of ['gpt_project/13_独立密码网页入口.md','password-site/vault-config.json','data/private/reference_document.json','source_documents/reference_ta.docx','artifacts/Bunny Chatting.html'])
    assert.equal(isBackupPath(file),true,file);
});
