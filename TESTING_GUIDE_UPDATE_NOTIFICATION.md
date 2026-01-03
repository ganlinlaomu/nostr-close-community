# 测试指南：验证更新通知修复

本指南将帮助您验证更新通知系统的修复是否正常工作。

## 前置准备

1. 确保您有两个不同的部署环境或版本：
   - 版本 A（旧版本）
   - 版本 B（新版本 - 包含此修复）

2. 准备测试浏览器：
   - Chrome/Edge（推荐使用无痕模式）
   - Firefox（推荐使用隐私窗口）
   - Safari

3. 打开浏览器开发者工具（F12）并查看 Console 选项卡

## 测试场景 1：全新浏览器首次访问

**目标**: 验证首次访问时不会显示"发现新版本"通知

**步骤**:
1. 打开浏览器的无痕/隐私模式
2. 访问应用 URL
3. 等待页面完全加载

**预期结果**:
- ❌ 不应该出现"发现新版本"的通知横幅
- ✅ 控制台应显示：`[SW] Fresh install, not sending update notification`
- ✅ 页面正常显示，无任何提示

**失败标志**:
- 看到"发现新版本"横幅
- 控制台显示：`[SW] Notifying clients about update`

---

## 测试场景 2：已有用户访问新版本

**目标**: 验证版本更新时正确显示通知

**步骤**:
1. 在浏览器中访问旧版本（版本 A）
2. 正常使用一会儿，确保 Service Worker 已安装
3. 部署新版本（版本 B）到服务器
4. 等待 60 秒左右（Service Worker 会自动检查更新）

**预期结果**:
- ✅ 应该在页面顶部看到"发现新版本"通知横幅
- ✅ 控制台应显示：
  ```
  [SW] Installing version: 0.1.0 2026-01-04
  [SW] Activating version: 0.1.0 2026-01-04
  [SW] Old caches found: ['closed-community-pwa-v0.1.0-2026-01-03', ...]
  [SW] Is update: true
  [SW] Notifying clients about update
  [UpdateNotification] SW updated
  ```
- ✅ 通知只显示一次，不会重复出现

**失败标志**:
- 没有看到更新通知
- 通知重复出现多次

---

## 测试场景 3：点击"立即刷新"

**目标**: 验证点击刷新后通知不会重复出现

**步骤**:
1. 在测试场景 2 的基础上，看到更新通知
2. 点击"立即刷新"按钮
3. 等待页面重新加载完成

**预期结果**:
- ✅ 页面成功重新加载
- ❌ 不应该再次看到"发现新版本"通知
- ✅ 控制台应显示：`[UpdateNotification] Clearing update-in-progress flag after reload`
- ✅ 应用运行在新版本上

**失败标志**:
- 页面重新加载后再次显示更新通知
- 出现无限刷新循环
- 页面显示空白或错误

---

## 测试场景 4：快速连续更新

**目标**: 验证在短时间内多次更新的处理

**步骤**:
1. 访问版本 A
2. 部署版本 B
3. 看到更新通知，点击"立即刷新"
4. 立即再部署版本 C（在刷新后 10 秒内）

**预期结果**:
- ✅ 第一次刷新成功，加载版本 B
- ❌ 在 10 秒内不应该再显示更新通知（即使检测到版本 C）
- ✅ 10 秒后，如果仍有新版本，才显示通知
- ✅ 控制台应显示：`[UpdateNotification] Recently updated, ignoring pending updates`

**失败标志**:
- 刷新后立即又看到更新通知
- 用户体验混乱

---

## 测试场景 5：多标签页同步

**目标**: 验证多个标签页中的更新通知行为

**步骤**:
1. 打开两个标签页，都访问旧版本
2. 部署新版本
3. 等待更新检测

**预期结果**:
- ✅ 两个标签页都应该显示更新通知
- ✅ 在任一标签页点击"立即刷新"
- ✅ 该标签页刷新后不再显示通知
- ℹ️ 另一个标签页的通知可能仍然存在（这是正常的）

---

## 测试场景 6：手动刷新页面

**目标**: 验证用户手动刷新（F5）时的行为

**步骤**:
1. 使用旧版本应用
2. 服务器部署新版本
3. 用户按 F5 或点击浏览器刷新按钮（不点击"立即刷新"）

**预期结果**:
- ✅ 页面重新加载
- ✅ `main.ts` 中的版本检测逻辑应该捕获到版本变化
- ✅ 自动清理旧数据并再次刷新
- ✅ 最终加载新版本，不显示更新通知
- ✅ 控制台应显示：
  ```
  [main] Version changed detected, handling update...
  [VersionManager] Version changed from 0.1.0 to 0.1.1
  [VersionManager] Clearing all app data...
  [main] Update complete, reloading...
  ```

---

## 调试技巧

### 检查 Service Worker 状态
```javascript
// 在浏览器控制台中运行
navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(reg => {
    console.log('SW version:', reg.active?.scriptURL);
  });
});
```

### 检查缓存
```javascript
// 查看所有缓存
caches.keys().then(keys => console.log('Cache keys:', keys));
```

### 检查 localStorage
```javascript
// 查看当前版本
console.log('App version:', localStorage.getItem('app_version'));
console.log('Last update check:', localStorage.getItem('last_update_check'));
```

### 检查 sessionStorage
```javascript
// 查看更新相关标志
console.log('Pending update:', sessionStorage.getItem('_pending_sw_update'));
console.log('Update in progress:', sessionStorage.getItem('_update_in_progress'));
console.log('Update timestamp:', sessionStorage.getItem('_update_timestamp'));
```

### 强制 Service Worker 更新
```javascript
// 立即检查更新
navigator.serviceWorker.ready.then(reg => reg.update());
```

### 清除所有数据（用于重新测试）
```javascript
// 清除 Service Worker
navigator.serviceWorker.getRegistrations().then(regs => {
  regs.forEach(reg => reg.unregister());
});

// 清除缓存
caches.keys().then(keys => {
  keys.forEach(key => caches.delete(key));
});

// 清除存储
localStorage.clear();
sessionStorage.clear();

// 然后刷新页面
location.reload();
```

---

## 常见问题

### Q1: 更新通知没有出现
**可能原因**:
- Service Worker 还没有检查更新（等待最多 60 秒）
- 浏览器缓存了旧的 Service Worker
- 版本号和构建时间没有改变

**解决方案**:
1. 检查 `public/service-worker.js` 中的 `BUILD_TIME` 是否更新
2. 在开发者工具中手动更新 Service Worker
3. 检查控制台日志

### Q2: 通知重复出现
**可能原因**:
- 修复未正确部署
- 浏览器使用了缓存的旧代码

**解决方案**:
1. 清除浏览器缓存
2. 使用无痕模式测试
3. 检查是否部署了最新版本

### Q3: 点击刷新后页面空白
**可能原因**:
- JavaScript 错误
- 版本管理器清理数据时出错

**解决方案**:
1. 检查控制台错误信息
2. 手动清除浏览器数据
3. 检查网络连接

---

## 测试检查清单

完成所有测试后，确认以下所有项都符合预期：

- [ ] 测试场景 1：全新浏览器首次访问 - 无更新通知 ✅
- [ ] 测试场景 2：已有用户访问新版本 - 显示更新通知 ✅
- [ ] 测试场景 3：点击"立即刷新" - 通知不重复 ✅
- [ ] 测试场景 4：快速连续更新 - 10秒内忽略新通知 ✅
- [ ] 测试场景 5：多标签页同步 - 行为正常 ✅
- [ ] 测试场景 6：手动刷新页面 - 自动处理版本变化 ✅

## 报告问题

如果发现任何问题，请提供以下信息：

1. **测试场景编号**
2. **浏览器类型和版本**
3. **控制台日志** (完整的)
4. **实际行为 vs 预期行为**
5. **截图或录屏** (如果可能)

---

## 总结

本次修复解决了以下问题：
1. ✅ 首次访问不再误显示更新通知
2. ✅ 点击刷新后通知不再重复
3. ✅ 真实更新时正确显示通知
4. ✅ 更好的日志用于调试

修复的核心是：
- Service Worker 能够区分首次安装和版本更新
- 添加了时间戳机制防止通知重复
- 完善了标志位清理逻辑
