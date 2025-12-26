# 海内是什么

海内，是只给朋友的地方。

它不是公共平台，
不展示给陌生人，
也不追求热度。

你看到的，只是你选择的人。
你说的话，也只会被他们听见。



# 基于nostr协议的封闭式社交平台
- 文字加密
- 图片加密
- 只对已添加的朋友可见
- 只展示来自已添加的朋友的信息
- 点对点评论

这是一个最小可运行示例，展示如何用 nostr-tools v2.18.2 实现：
- 登录 / 退出（私钥保存在本地，仅用于演示）
- 信息流（timeline）订阅并解密 per-message NIP‑44 风格消息（不在 tags 写 p）
- 发帖（每条消息为每个接收者生成一次性对称密钥并用 nip04 加密）
- **好友列表加密同步**（使用 NIP-51 + NIP-33，保存在中继并加密，支持跨设备同步）
- **互动（点赞/评论）跨设备同步**（支持不同在线时长设备间的3天互动同步）
- 设置（自定义 relays 与 blossom 图床地址）
- PWA 基础文件（manifest + service worker）

## 好友列表同步功能（NIP-51）


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
