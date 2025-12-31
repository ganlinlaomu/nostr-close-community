# 海内是什么

海内，是只给朋友的地方。

你看到的，只是你选择的人。
你说的话，也只会被他们听见。



# 基于nostr协议的封闭式朋友圈
- 文字加密
- 图片加密
- 只对已添加的朋友可见
- 只展示来自已添加的朋友的信息
- 点对点评论


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
