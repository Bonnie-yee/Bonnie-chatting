// Passwords and runtime credentials are local-only, including in a private repository.
export function isBackupPath(name) {
  return !/(^|\/)(runtime|node_modules|\.sites-runtime|\.git|previews)(\/|$)|(^|\/)\.env|\.(pem|key|log|zip|tgz)$|(^|\/)[^/]*(访问密码|access[-_ ]?password|credentials?)[^/]*\.(txt|json|md)$/i.test(name);
}
