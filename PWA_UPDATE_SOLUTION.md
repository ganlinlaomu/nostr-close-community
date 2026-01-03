# PWA 更新和缓存管理解决方案

## 问题描述

在之前的版本中，用户在应用更新后经常遇到空白页面问题，必须手动清除浏览器缓存才能正常使用。这是因为：

1. **Service Worker 使用静态版本号**：旧的 SW 使用 `v1` 这样的静态版本号，导致缓存永远不会更新
2. **混合版本问题**：浏览器加载了新的 HTML 但使用旧的 JS 文件，造成不兼容
3. **IndexedDB 结构不匹配**：旧代码尝试读取新的数据库结构，导致崩溃
4. **无用户通知**：用户不知道有更新可用，也不知道需要刷新

## 解决方案概述

我们实现了一个全面的 PWA 更新管理系统：

### 1. 动态版本管理的 Service Worker

**文件**: `public/service-worker.js`

**关键改进**:
- ✅ 使用 `package.json` 中的版本号和构建时间作为缓存名称
- ✅ 为 HTML 和静态资源使用不同的缓存策略
- ✅ HTML 使用 **Network-First** 策略（始终获取最新版本）
- ✅ 静态资源使用 **Cache-First** 策略（提高性能）
- ✅ 自动清理旧缓存
- ✅ 向客户端发送更新通知

**缓存策略**:
```javascript
// HTML: Network-First（始终尝试获取最新）
if (request.mode === 'navigate' || request.destination === 'document') {
  return fetch(request)  // 优先网络
    .catch(() => caches.match(request));  // 离线时使用缓存
}

// 静态资源: Cache-First（优先使用缓存）
return caches.match(request) || fetch(request);
```

### 2. 版本跟踪和管理

**文件**: `src/utils/versionManager.ts`

**功能**:
- 📦 在 localStorage 中跟踪应用版本
- 🔍 检测版本变化
- 🧹 在版本更改时清除所有应用数据（缓存、存储、Service Worker）
- ♻️ 处理更新流程

**工作流程**:
1. 应用启动时检查存储的版本
2. 如果版本已更改：
   - 清除所有缓存
   - 注销所有 Service Worker
   - 清理 localStorage/sessionStorage（保留版本标记）
   - 重新加载页面
3. 如果版本未更改：
   - 正常启动应用

### 3. 用户友好的更新通知

**文件**: `src/components/UpdateNotification.vue`

**特性**:
- 🎨 美观的顶部横幅通知
- 📢 监听 Service Worker 更新消息
- 👆 允许用户手动触发更新
- 🔄 带有加载状态的更新按钮
- 📱 移动端响应式设计

**交互流程**:
1. Service Worker 检测到更新
2. 向应用发送 `SW_UPDATED` 消息
3. 显示更新横幅
4. 用户点击"立即更新"按钮
5. 清理旧数据并重新加载页面

### 4. 应用启动时的版本检查

**文件**: `src/main.ts`

**改进**:
- ⚡ 在挂载应用**之前**检查版本
- 🔄 自动处理版本不匹配
- ⏰ 每 60 秒定期检查更新
- 📝 改进的 Service Worker 注册日志

**启动流程**:
```javascript
const versionChanged = initVersionTracking();

if (versionChanged) {
  // 检测到版本变化 - 处理更新并重新加载
  handleVersionUpdate()
    .then(() => window.location.reload());
} else {
  // 正常应用初始化
  app.mount("#app");
}
```

### 5. 自动化版本更新脚本

**文件**: `scripts/update-sw-version.js`

**目的**:
- 🤖 在构建时自动更新 Service Worker 版本
- 📅 生成唯一的构建时间戳
- 🔗 与 `package.json` 版本同步

**使用方法**:
```bash
npm run build  # 自动运行版本更新脚本
```

脚本会：
1. 读取 `package.json` 获取版本号
2. 生成当前日期作为构建时间
3. 更新 `service-worker.js` 中的 VERSION 和 BUILD_TIME

## 部署流程

### 开发部署

1. **更新版本号**（如果是新版本）:
   ```bash
   # 在 package.json 中更新版本号
   # 例如：从 "0.1.0" 改为 "0.1.1"
   ```

2. **构建应用**:
   ```bash
   npm run build
   ```
   
   这会自动：
   - 运行 `update-sw-version.js` 脚本
   - 更新 Service Worker 的版本和构建时间
   - 构建应用

3. **部署到服务器**:
   ```bash
   # 将 dist/ 目录部署到您的服务器
   # 例如：上传到 pwa.lostr.space
   ```

### 用户端体验

1. **首次访问** (例如版本 0.1.0):
   - Service Worker 安装
   - 缓存静态资源
   - 版本 "0.1.0" 存储在 localStorage

2. **应用更新后** (部署了版本 0.1.1):
   
   **场景 A**: 用户下次访问时
   - 应用检测到版本从 "0.1.0" 变为 "0.1.1"
   - 自动清除旧数据
   - 重新加载页面
   - ✅ 干净启动，无空白页面

   **场景 B**: 用户正在使用应用时
   - Service Worker 在后台更新
   - 显示更新通知横幅
   - 用户点击"立即更新"
   - 清除旧数据并重新加载
   - ✅ 平滑过渡到新版本

## 技术细节

### 版本检测机制

```typescript
// src/utils/versionManager.ts
export function hasVersionChanged(): boolean {
  const stored = getStoredVersion();  // 从 localStorage 获取
  
  if (!stored) return false;  // 首次访问
  
  if (stored !== APP_VERSION) {
    console.log(`版本从 ${stored} 变为 ${APP_VERSION}`);
    return true;
  }
  
  return false;
}
```

### Service Worker 更新流程

```javascript
// public/service-worker.js
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      // 1. 删除所有旧缓存
      caches.keys().then(keys => 
        Promise.all(keys.map(key => {
          if (key !== CURRENT_CACHE_NAME) {
            return caches.delete(key);
          }
        }))
      ),
      // 2. 立即控制所有客户端
      self.clients.claim(),
      // 3. 通知所有客户端
      self.clients.matchAll().then(clients => {
        clients.forEach(client => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: VERSION
          });
        });
      })
    ])
  );
});
```

### 缓存命名策略

```javascript
const VERSION = '0.1.0';
const BUILD_TIME = '2026-01-03';

// 每次构建都有唯一的缓存名称
const CACHE_NAME = `closed-community-pwa-v${VERSION}-${BUILD_TIME}`;
const HTML_CACHE_NAME = `html-${CACHE_NAME}`;
const ASSETS_CACHE_NAME = `assets-${CACHE_NAME}`;
```

## 优势

### ✅ 用户体验
- **无更多空白页面**：版本不匹配时自动处理
- **平滑更新**：清晰的更新通知和反馈
- **离线支持**：仍然可以离线工作，同时正确处理更新

### ✅ 开发者体验
- **自动化**：构建时自动更新版本
- **清晰的日志**：改进的控制台日志用于调试
- **易于维护**：版本管理集中在一处

### ✅ 可靠性
- **正确的缓存失效**：旧缓存始终被清除
- **数据一致性**：版本不匹配时清理旧数据
- **防错**：多层检查和回退机制

## 测试建议

### 手动测试更新流程

1. **初始部署**:
   ```bash
   npm run build
   # 部署到测试环境
   ```

2. **首次访问**:
   - 打开浏览器开发者工具
   - 访问应用
   - 检查控制台：`[SW] Installing version: 0.1.0`
   - 检查 localStorage：`app_version = "0.1.0"`

3. **模拟更新**:
   ```bash
   # 更改 package.json 版本为 "0.1.1"
   npm run build
   # 部署更新
   ```

4. **测试更新检测**:
   - 刷新页面
   - 应该看到：`[VersionManager] Version changed from 0.1.0 to 0.1.1`
   - 页面应该自动重新加载
   - 检查 localStorage：`app_version = "0.1.1"`

5. **测试实时更新通知**:
   - 保持应用打开
   - 部署新版本
   - 等待最多 60 秒
   - 应该看到顶部更新横幅
   - 点击"立即更新"
   - 页面应该重新加载到新版本

### 自动化测试（未来改进）

可以考虑添加：
- E2E 测试用于更新流程
- Service Worker 单元测试
- 版本检测逻辑的单元测试

## 故障排除

### 问题：更新后仍然看到空白页面

**解决方案**:
1. 检查浏览器控制台是否有错误
2. 手动清除浏览器数据
3. 检查 Service Worker 是否正确更新：
   - 开发者工具 > Application > Service Workers
   - 应该看到新的 SW 版本
4. 检查 localStorage 中的 `app_version`

### 问题：更新通知未显示

**检查**:
1. Service Worker 是否已注册：
   ```javascript
   navigator.serviceWorker.getRegistrations()
   ```
2. 控制台中是否有 `[SW] Activating version` 日志
3. UpdateNotification 组件是否已挂载

### 问题：频繁的重新加载循环

**原因**: 版本检测逻辑可能有问题

**解决方案**:
1. 确保 `storeCurrentVersion()` 被调用
2. 检查 localStorage 权限
3. 验证 APP_VERSION 导出正确

## 未来改进

### 可能的增强功能

1. **增量更新**:
   - 仅更新更改的资源
   - 保留用户数据（如果兼容）

2. **后台同步**:
   - 在后台同步用户数据到新版本
   - 在更新期间显示进度

3. **版本回滚**:
   - 保留以前版本的缓存
   - 允许在出现问题时回滚

4. **更好的更新调度**:
   - 在空闲时间更新
   - 避免在用户活动期间更新

5. **A/B 测试支持**:
   - 支持多个版本
   - 逐步推出新功能

## 参考资料

- [Service Worker API - MDN](https://developer.mozilla.org/zh-CN/docs/Web/API/Service_Worker_API)
- [PWA 缓存策略](https://web.dev/offline-cookbook/)
- [Workbox（未来可能使用）](https://developers.google.com/web/tools/workbox)
- [Dexie.js 版本管理](https://dexie.org/docs/Tutorial/Design#database-versioning)

## 总结

这个解决方案通过以下方式解决了 PWA 更新后的空白页面问题：

1. **动态版本管理**：每次构建时自动生成唯一的缓存版本
2. **智能缓存策略**：HTML 使用 Network-First，资源使用 Cache-First
3. **自动更新检测**：启动时和运行时检测版本变化
4. **用户友好的通知**：清晰的更新提示和平滑的更新流程
5. **自动化工具**：构建脚本简化部署流程

用户现在可以享受无缝的更新体验，而开发者只需正常构建和部署即可。
