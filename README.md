```markdown
# Closed Community PWA (nostr-tools@2.18.2)

这是一个最小可运行示例，展示如何用 nostr-tools v2.18.2 实现：
- 登录 / 退出（私钥保存在本地，仅用于演示）
- 信息流（timeline）订阅并解密 per-message NIP‑44 风格消息（不在 tags 写 p）
- 发帖（每条消息为每个接收者生成一次性对称密钥并用 nip04 加密）
- 好友列表（备注、分组，保存在 IndexedDB）
- 设置（自定义 relays 与 blossom 图床地址）
- PWA 基础文件（manifest + service worker）

重要安全说明
- 本示例为 demo 与开发使用：**私钥与对称密钥不应以明文存储在 localStorage**。请在生产中使用更安全的本地密钥存储策略（WebAuthn、非导出密钥、PBKDF2/AES-GCM 加密并保存到 IndexedDB）。
- per-message NIP‑44 模式会在事件 content 中包含 recipients（payload.keys），任何能读取该事件 content 的第三方（包括 relay）都能看到接收者名单。如果你需要在事件中完全不暴露接收者，请采用 group-key（一次性分发）+ broadcast 或私有 relay。

环境要求
- Node.js 16+（建议 18+）
- npm 或 yarn

安装与运行
1. 克隆 / 拷贝项目代码到本地
2. 安装依赖：
   npm install
   或
   yarn install

3. 运行开发服务器：
   npm run dev
   或
   yarn dev

4. 打开浏览器访问开发 URL（通常 http://localhost:5173）

构建
- npm run build
- npm run preview

如何使用（快速）
- 打开 /login，用你的 nostr 私钥（hex）登录或生成临时私钥。
- 在 /friends 添加一些好友 pubkey（作为 demo，你可以把自己生成的 pubkey 也添加）。
- 到 /post 发帖，填写接收者 pubkeys（逗号或换行分隔）并发送。
- 到首页点击“开始订阅并实时接收”以订阅你的好友（authors）并解密收到的消息。

若需我：
- 把私钥存储改为“PBKDF2 + AES-GCM 存入 Dexie”的安全实现（包含导出/导入），选择 A；
- 或把 per-message 模式替换为 group-key broadcast 模式（消息 content 不含 recipients），选择 B；
- 或把项目推送到你指定的 GitHub 仓库（请提供 owner/name、分支名与提交信息），选择 C。

请回复你接下来的需求（A / B / C / 无需）。
```
