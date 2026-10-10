# 免费托管候选：尚未部署

本目录是 EdgeOne Makers 的候选发布包，只有不含聊天明文的密码入口和三个固定的 API 代理。账号、域名及大陆/香港可达性尚未验证，不得当作已上线的第二网址。

服务器需要 secret `BONNIE_SOURCE_SERVICE_TOKEN`，只允许配置在运行时，不能上传到仓库或浏览器。代理保持源站密码校验，只返回加密载荷；浏览器无需请求 chatgpt.site，云端源站保留已有反馈更新与尝试限制。函数源站网络连通性仍须在平台上实测。

生成前端：从应用根目录执行 `node scripts/build-free-gateway.mjs`。发布时项目根目录选本目录，使用免费套餐，绑定自定义域名。依据官方文档，默认域名在大陆仅有三小时有效的预览访问，不能作为固定入口。

官方资料：https://pages.edgeone.ai/pricing 、 https://pages.edgeone.ai/document/domain-overview 、 https://pages.edgeone.ai/document/node-functions 。
