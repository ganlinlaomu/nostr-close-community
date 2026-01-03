# PWA 更新功能测试指南

## 测试前准备

### 1. 搭建测试环境

```bash
# 克隆仓库
git clone https://github.com/ganlinlaomu/HaiNei.git
cd HaiNei

# 切换到更新分支
git checkout copilot/fix-empty-screen-issue

# 安装依赖
npm install
```

### 2. 准备两个版本

**版本 A (初始版本 0.1.0)**
```bash
# 确保 package.json 中版本为 0.1.0
npm run build

# 部署 dist/ 到测试服务器（如 pwa.lostr.space）
```

**版本 B (更新版本 0.1.1)**
```bash
# 修改 package.json
{
  "version": "0.1.1",
  ...
}

# 构建新版本
npm run build

# 保存 dist/ 到另一个文件夹（稍后部署）
```

## 测试场景

### 场景 1: 首次访问（基准测试）

**目的**: 验证应用正常安装和 Service Worker 注册

**步骤**:
1. 清除所有浏览器数据（重要！）
   - Chrome: Settings > Privacy and security > Clear browsing data
   - 选择 "All time" 并勾选所有选项
2. 访问 `https://pwa.lostr.space`（或你的测试 URL）
3. 打开开发者工具 > Console

**预期结果**:
```
[SW] Installing version: 0.1.0 2026-01-03
[SW] Activating version: 0.1.0 2026-01-03
[main] Service Worker registered successfully
```

**验证**:
- 应用正常显示，无空白页面
- 检查 Application > Service Workers: 应该看到一个活动的 SW
- 检查 Application > Storage > Local Storage: `app_version = "0.1.0"`
- 检查 Application > Cache Storage: 应该有 2-3 个缓存条目

---

### 场景 2: 版本更新 - 离线用户再次访问

**目的**: 测试版本检测和自动清理功能

**步骤**:
1. 保持浏览器打开（从场景 1）
2. **不要刷新页面**
3. 在服务器上部署版本 B (0.1.1)
4. 关闭浏览器标签页
5. 等待 10 秒
6. 重新打开 `https://pwa.lostr.space`
7. 观察开发者工具控制台

**预期结果**:
```
[VersionManager] Version changed from 0.1.0 to 0.1.1
[VersionManager] Clearing all app data...
[VersionManager] Cleared caches: [...]
[VersionManager] Unregistered service workers
[VersionManager] Deleted database: closed_community_db
[VersionManager] All app data cleared successfully
[main] Update complete, reloading...
```

**验证**:
- 页面自动重新加载
- 应用正常显示，无空白页面
- localStorage 中 `app_version = "0.1.1"`
- 旧的缓存已被清除
- Service Worker 是新版本（0.1.1）

**❌ 如果失败**: 应该看到 alert "检测到应用更新，正在刷新页面..." 然后强制刷新

---

### 场景 3: 版本更新 - 在线用户实时通知

**目的**: 测试实时更新通知功能

**步骤**:
1. 访问 `https://pwa.lostr.space`（版本 A）
2. 保持页面打开
3. 打开开发者工具 > Console
4. 在服务器上部署版本 B (0.1.1)
5. 等待最多 60 秒（SW 会自动检查更新）
6. 观察页面顶部

**预期结果**:
- 页面顶部出现紫色渐变横幅
- 显示 "🔄 发现新版本"
- 按钮显示 "立即更新"
- 控制台输出: `[UpdateNotification] SW updated {version: "0.1.1", ...}`

**交互测试**:
1. 点击 "立即更新" 按钮
2. 按钮文字变为 "更新中..."
3. 控制台输出:
   ```
   [VersionManager] Clearing all app data...
   [VersionManager] All app data cleared successfully
   ```
4. 页面自动刷新
5. 应用加载新版本 (0.1.1)，无空白页面

---

### 场景 4: Service Worker 更新（无版本变化）

**目的**: 测试 SW 文件更新但版本号未变的情况

**步骤**:
1. 修改 `public/service-worker.js`，添加一条注释
   ```javascript
   // Test comment
   ```
2. 重新构建（不改变 package.json 版本）
3. 部署到服务器
4. 访问应用或等待 60 秒

**预期结果**:
- 显示更新通知横幅
- 点击更新后正常刷新
- 没有清除 localStorage（因为版本号相同）

---

### 场景 5: 离线模式

**目的**: 验证离线功能仍然正常工作

**步骤**:
1. 访问 `https://pwa.lostr.space`
2. 等待应用完全加载
3. 打开开发者工具 > Network
4. 选择 "Offline" 模式
5. 刷新页面

**预期结果**:
- 应用仍然可以加载（从缓存）
- HTML 和静态资源从 Cache Storage 加载
- 应用功能正常（除了需要网络的功能）

---

### 场景 6: 混合缓存清理测试

**目的**: 验证旧缓存正确清理

**步骤**:
1. 部署版本 A (0.1.0)
2. 访问应用
3. 检查 Application > Cache Storage，记录缓存名称
4. 部署版本 B (0.1.1)  
5. 访问应用（触发更新）
6. 再次检查 Cache Storage

**预期结果**:
```
Before:
- closed-community-pwa-v0.1.0-2026-01-03
- html-closed-community-pwa-v0.1.0-2026-01-03
- assets-closed-community-pwa-v0.1.0-2026-01-03

After:
- closed-community-pwa-v0.1.1-2026-01-03
- html-closed-community-pwa-v0.1.1-2026-01-03
- assets-closed-community-pwa-v0.1.1-2026-01-03

(旧缓存已被删除)
```

---

### 场景 7: IndexedDB 清理测试

**目的**: 验证 IndexedDB 在版本更新时正确清理

**步骤**:
1. 访问版本 A
2. 在应用中创建一些数据（消息、朋友等）
3. 打开 Application > IndexedDB > closed_community_db
4. 确认有数据存在
5. 部署版本 B 并访问
6. 再次检查 IndexedDB

**预期结果**:
- IndexedDB `closed_community_db` 被删除
- 创建了新的空 IndexedDB
- 应用正常运行，无错误
- 用户需要重新登录（因为数据被清除）

---

### 场景 8: 错误处理测试

**目的**: 验证更新失败时的降级处理

**步骤**:
1. 打开开发者工具 > Console
2. 注入错误（模拟清理失败）:
   ```javascript
   // 在 handleVersionUpdate 前
   Storage.prototype.setItem = function() {
     throw new Error('Storage quota exceeded');
   };
   ```
3. 触发版本更新

**预期结果**:
- 看到错误日志
- 显示 alert: "检测到应用更新，正在刷新页面..."
- 页面仍然刷新（降级处理）

---

### 场景 9: 多标签页测试

**目的**: 验证多个标签页同时更新的行为

**步骤**:
1. 打开 3 个标签页访问版本 A
2. 部署版本 B
3. 等待 60 秒或手动触发更新检查
4. 观察所有标签页

**预期结果**:
- 所有标签页都显示更新通知横幅
- 在任意标签页点击 "立即更新"
- 该标签页刷新到新版本
- 其他标签页可独立更新（用户控制）

---

### 场景 10: 快速连续更新测试

**目的**: 测试快速连续发布多个版本的情况

**步骤**:
1. 部署 0.1.0，访问
2. 快速部署 0.1.1，等待 10 秒
3. 快速部署 0.1.2，等待 10 秒
4. 点击更新通知

**预期结果**:
- 应用直接跳到最新版本 (0.1.2)
- 中间版本的缓存被跳过
- 无数据损坏或错误

---

## 自动化测试脚本

### 版本切换脚本

```bash
#!/bin/bash
# test-version-update.sh

echo "Building version 0.1.0..."
jq '.version = "0.1.0"' package.json > package.tmp && mv package.tmp package.json
npm run build
cp -r dist dist-v0.1.0

echo "Building version 0.1.1..."
jq '.version = "0.1.1"' package.json > package.tmp && mv package.tmp package.json
npm run build
cp -r dist dist-v0.1.1

echo "Version builds ready:"
echo "- dist-v0.1.0"
echo "- dist-v0.1.1"
```

### 快速部署脚本

```bash
#!/bin/bash
# deploy-test-version.sh

VERSION=$1
if [ -z "$VERSION" ]; then
  echo "Usage: ./deploy-test-version.sh [0.1.0|0.1.1]"
  exit 1
fi

echo "Deploying version $VERSION..."
rm -rf /var/www/html/*
cp -r dist-v${VERSION}/* /var/www/html/
echo "Version $VERSION deployed!"
```

---

## 性能测试

### 测试缓存策略效率

**工具**: Chrome DevTools > Network > Throttling

**步骤**:
1. 设置 "Fast 3G" 网络
2. 清除缓存
3. 访问应用，记录加载时间
4. 刷新页面（应从缓存加载），记录加载时间

**预期结果**:
```
First Load:  ~3-5 seconds (network)
Cache Load:  <500ms (cache-first)
```

---

## 兼容性测试

### 浏览器支持

测试以下浏览器:
- ✅ Chrome 90+ (Desktop & Mobile)
- ✅ Edge 90+
- ✅ Firefox 88+
- ✅ Safari 14+ (iOS & macOS)
- ⚠️ Safari 13.x (部分支持，indexedDB.databases() 不可用)

### 降级测试

**不支持 Service Worker 的浏览器**:
- 应用仍然可以正常使用
- 没有离线功能
- 没有更新通知
- 版本检测通过 localStorage 仍然工作

---

## 问题诊断清单

### 问题: 更新后仍然空白页面

**检查**:
1. 控制台是否有 JavaScript 错误？
2. Service Worker 是否更新到新版本？
3. localStorage 中的 `app_version` 是否更新？
4. 是否有旧缓存未清理？

**解决**:
```javascript
// 在控制台运行
localStorage.getItem('app_version')
navigator.serviceWorker.getRegistrations()
caches.keys()
```

### 问题: 更新通知不显示

**检查**:
1. Service Worker 是否注册？
2. 控制台是否有错误？
3. UpdateNotification 组件是否挂载？

**解决**:
```javascript
// 在控制台运行
navigator.serviceWorker.controller
navigator.serviceWorker.ready
```

### 问题: 频繁刷新循环

**检查**:
1. `storeCurrentVersion()` 是否被调用？
2. localStorage 是否被禁用？
3. 版本号格式是否正确？

---

## 测试报告模板

```markdown
## PWA 更新功能测试报告

**测试日期**: YYYY-MM-DD
**测试人员**: XXX
**测试环境**: Chrome 120 / macOS 14

### 测试结果

| 场景 | 状态 | 备注 |
|------|------|------|
| 场景 1: 首次访问 | ✅ 通过 | |
| 场景 2: 离线更新 | ✅ 通过 | |
| 场景 3: 在线通知 | ✅ 通过 | |
| 场景 4: SW 更新 | ✅ 通过 | |
| 场景 5: 离线模式 | ✅ 通过 | |
| 场景 6: 缓存清理 | ✅ 通过 | |
| 场景 7: DB 清理 | ✅ 通过 | |
| 场景 8: 错误处理 | ✅ 通过 | |
| 场景 9: 多标签页 | ✅ 通过 | |
| 场景 10: 快速更新 | ✅ 通过 | |

### 发现的问题

1. [描述问题]
2. [描述问题]

### 性能指标

- 首次加载: XX ms
- 缓存加载: XX ms
- 更新时间: XX ms

### 建议

[测试建议和改进意见]
```

---

## 持续监控

### 生产环境监控

部署后，监控以下指标:

1. **用户升级率**
   - 跟踪有多少用户成功更新到新版本
   - 使用 Google Analytics 自定义事件

2. **错误率**
   - 监控控制台错误
   - 使用 Sentry 或类似工具

3. **更新延迟**
   - 从部署到用户看到通知的平均时间
   - 目标: <60 秒

4. **空白页面报告**
   - 通过用户反馈跟踪
   - 目标: 0 报告

---

## 总结

完成所有测试场景后，你应该能够验证:

✅ PWA 更新功能完全正常
✅ 不再出现空白页面问题
✅ 用户体验流畅
✅ 自动化构建流程正常
✅ 错误处理健壮

如有任何测试失败，请参考问题诊断清单或查看 `PWA_UPDATE_SOLUTION.md` 了解详细实现。
