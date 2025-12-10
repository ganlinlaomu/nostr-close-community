# Closed Community PWA (nostr-tools@2.18.2)

这是一个最小可运行示例，展示如何用 nostr-tools v2.18.2 实现：
- 登录 / 退出（私钥保存在本地，仅用于演示）
- 信息流（timeline）订阅并解密 per-message NIP‑44 风格消息（不在 tags 写 p）
- 发帖（每条消息为每个接收者生成一次性对称密钥并用 nip04 加密）
- **好友列表加密同步**（使用 NIP-51 + NIP-33，保存在中继并加密，支持跨设备同步）
- 设置（自定义 relays 与 blossom 图床地址）
- PWA 基础文件（manifest + service worker）

## 好友列表同步功能（NIP-51）

好友列表现在支持加密同步到中继服务器，解决了跨设备同步的问题：

### 特性
- **加密存储**：使用 NIP-04 对好友列表内容加密，保护隐私
- **参数化可替换事件**：使用 kind 30000（People List）+ d 标签 "close-friends"
- **跨设备同步**：新设备登录时自动从中继拉取好友列表
- **自动同步**：添加、删除、修改好友时自动同步到中继
- **手动同步**：在好友列表页面提供手动同步按钮
- **向后兼容**：保留本地 localStorage 存储，与中继同步互补

### 工作原理
1. **登录时**：如果本地无数据，自动从中继拉取；如果有数据，后台同步到中继
2. **修改时**：任何添加、删除、编辑操作都会自动触发后台同步
3. **格式**：好友信息（公钥、昵称、分组）加密后存储在 content 字段，同时在 tags 中添加 "p" 标签符合 NIP-51 规范

### 技术实现
- 事件类型：kind 30000（NIP-51 People List）
- 参数化标识：["d", "close-friends"]
- 加密方式：NIP-04（对称加密，自己加密给自己）
- 标签格式：["p", "<friend_pubkey>", "", "<petname>"]

## 重要安全说明
- 本示例为 demo 与开发使用：**私钥与对称密钥不应以明文存储在 localStorage**。请在生产中使用更安全的本地密钥存储策略（WebAuthn、非导出密钥、PBKDF2/AES-GCM 加密并保存到 IndexedDB）。
- per-message NIP‑44 模式会在事件 content 中包含 recipients（payload.keys），任何能读取该事件 content 的第三方（包括 relay）都能看到接收者名单。如果你需要在事件中完全不暴露接收者，请采用 group-key（一次性分发）+ broadcast 或私有 relay。

## 环境要求
- Node.js 16+（建议 18+）
- npm 或 yarn

## 安装与运行
1. 克隆 / 拷贝项目代码到本地
2. 安装依赖：
   ```bash
   npm install
   ```
   或
   ```bash
   yarn install
   ```

3. 运行开发服务器：
   ```bash
   npm run dev
   ```
   或
   ```bash
   yarn dev
   ```

4. 打开浏览器访问开发 URL（通常 http://localhost:5173）

## 构建
```bash
npm run build
npm run preview
```

## 如何使用（快速）
- 打开 /login，用你的 nostr 私钥（hex）登录或生成临时私钥。
- 在 /friends 添加一些好友 pubkey（作为 demo，你可以把自己生成的 pubkey 也添加）。
- 好友列表会自动加密同步到中继，可以点击"同步"按钮手动触发同步。
- 在新设备登录同一账户时，好友列表会自动从中继恢复。
- 到 /post 发帖，填写接收者 pubkeys（逗号或换行分隔）并发送。
- 到首页点击"开始订阅并实时接收"以订阅你的好友（authors）并解密收到的消息。
