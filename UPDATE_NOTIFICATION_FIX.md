# 更新通知修复说明

## 问题描述

原始问题：
1. 全新浏览器首次打开网站时，错误显示"发现新版本"提醒
2. 点击"立即刷新"后，提醒依然存在
3. 只有关闭重新打开网址才能清除提醒
4. 旧版本浏览器刷新后没有提醒出现

## 修复方案

### 1. Service Worker 改进 (`public/service-worker.js`)

**问题根源**: Service Worker 在每次激活时都会向所有客户端发送 `SW_UPDATED` 消息，即使是首次安装也会触发。

**解决方案**: 
- 在激活时检查是否存在旧缓存
- 只有存在旧缓存时（表示是更新而非首次安装），才发送 `SW_UPDATED` 消息
- 通过检查 cache keys 来判断是否为更新

```javascript
// 检查是否存在旧缓存
const oldCaches = keys.filter(key => 
  key !== ASSETS_CACHE_NAME && 
  key !== HTML_CACHE_NAME &&
  (key.startsWith('closed-community-pwa-') || 
   key.startsWith('html-') || 
   key.startsWith('assets-'))
);
const isUpdate = oldCaches.length > 0;

// 只在真正更新时通知客户端
if (isUpdate) {
  // 发送 SW_UPDATED 消息
}
```

### 2. 更新通知组件改进 (`src/components/UpdateNotification.vue`)

**问题根源**: 用户点击"立即刷新"后，页面重新加载，但 Service Worker 可能在页面加载时再次发送更新消息，导致通知再次显示。

**解决方案**:
- 添加更新时间戳跟踪
- 在用户触发更新时记录时间戳
- 页面重新加载后，如果发现最近 10 秒内有过更新，则忽略任何待处理的更新通知
- 确保所有相关标志位在适当时机被清理

```javascript
// 点击更新时设置时间戳
sessionStorage.setItem('_update_timestamp', Date.now().toString());

// 页面加载时检查
const updateTimestamp = sessionStorage.getItem('_update_timestamp');
if (updateTimestamp) {
  const timeSinceUpdate = Date.now() - parseInt(updateTimestamp);
  if (timeSinceUpdate < 10000) { // 10 秒内
    // 忽略通知
    return;
  }
}
```

## 测试场景

### 场景 1: 首次访问（全新浏览器）

**预期行为**:
1. 打开浏览器，首次访问网站
2. Service Worker 安装并激活
3. ❌ **不应该**显示"发现新版本"通知
4. 控制台应显示: `[SW] Fresh install, not sending update notification`

**测试步骤**:
```bash
1. 使用隐私/无痕模式打开浏览器
2. 访问网站 URL
3. 观察是否出现更新通知
4. 检查浏览器控制台日志
```

### 场景 2: 版本更新

**预期行为**:
1. 用户正在使用旧版本应用
2. 开发者部署新版本（BUILD_TIME 改变）
3. Service Worker 检测到更新
4. ✅ **应该**显示"发现新版本"通知（只显示一次）
5. 控制台应显示: `[SW] Notifying clients about update`

**测试步骤**:
```bash
1. 部署应用版本 A
2. 在浏览器中访问并使用
3. 修改 BUILD_TIME，部署版本 B
4. 保持浏览器打开，等待最多 60 秒
5. 应该看到更新通知
```

### 场景 3: 点击立即刷新

**预期行为**:
1. 用户看到"发现新版本"通知
2. 点击"立即刷新"按钮
3. 页面重新加载
4. ❌ **不应该**再次显示更新通知
5. 控制台应显示: `[UpdateNotification] Clearing update-in-progress flag after reload`

**测试步骤**:
```bash
1. 在场景 2 的基础上
2. 点击"立即刷新"按钮
3. 等待页面重新加载
4. 确认通知不再显示
5. 检查 sessionStorage 中的标志位已清除
```

### 场景 4: 旧版本浏览器刷新

**预期行为**:
1. 用户使用旧版本应用
2. 手动刷新页面（F5 或刷新按钮）
3. 如果服务器已部署新版本
4. ✅ **应该**在 `main.ts` 中检测到版本变化
5. 自动清理并重新加载
6. ✅ **应该**在重新加载后显示新版本（不显示通知）

**测试步骤**:
```bash
1. 使用旧版本应用
2. 服务器部署新版本
3. 手动刷新浏览器（F5）
4. 检查 localStorage 中的 app_version
5. 确认应用已更新到新版本
```

## 调试日志

### Service Worker 日志

**首次安装**:
```
[SW] Installing version: 0.1.0 2026-01-03
[SW] Activating version: 0.1.0 2026-01-03
[SW] Old caches found: none
[SW] Is update: false
[SW] Fresh install, not sending update notification
```

**版本更新**:
```
[SW] Installing version: 0.1.0 2026-01-04
[SW] Activating version: 0.1.0 2026-01-04
[SW] Old caches found: ['closed-community-pwa-v0.1.0-2026-01-03', ...]
[SW] Is update: true
[SW] Notifying clients about update
```

### 更新通知组件日志

**接收到更新消息**:
```
[UpdateNotification] SW updated {type: 'SW_UPDATED', version: '0.1.0', buildTime: '2026-01-04'}
```

**用户点击刷新**:
```
[UpdateNotification] Clearing update-in-progress flag after reload
```

**最近刚更新过**:
```
[UpdateNotification] Recently updated, ignoring pending updates
```

## 相关文件

- `public/service-worker.js` - Service Worker 主文件
- `src/components/UpdateNotification.vue` - 更新通知组件
- `src/utils/versionManager.ts` - 版本管理工具
- `src/main.ts` - 应用入口，版本检测

## 技术细节

### sessionStorage 标志位

1. `_pending_sw_update`: 标记有待处理的更新
2. `_update_in_progress`: 标记正在进行更新
3. `_update_timestamp`: 记录更新触发的时间戳

### 时间窗口

- **10 秒宽限期**: 用户触发更新后 10 秒内，忽略所有 SW 更新消息
- **60 秒检查间隔**: 每 60 秒检查一次 Service Worker 更新

### Cache 命名规则

```
closed-community-pwa-v{VERSION}-{BUILD_TIME}
html-closed-community-pwa-v{VERSION}-{BUILD_TIME}
assets-closed-community-pwa-v{VERSION}-{BUILD_TIME}
```

通过检查是否存在旧的 cache 名称来判断是否为更新。

## 总结

修复通过以下方式解决了问题：

1. ✅ **智能更新检测**: Service Worker 现在能够区分首次安装和版本更新
2. ✅ **防止重复通知**: 添加时间戳机制防止刷新后再次显示通知
3. ✅ **更好的日志**: 清晰的控制台日志便于调试和验证
4. ✅ **标志位管理**: 完善的 sessionStorage 标志位清理逻辑

用户现在将获得更流畅的更新体验：
- 首次访问不会看到误导性的更新通知
- 实际更新时会看到一次清晰的通知
- 点击刷新后通知不会重复出现
