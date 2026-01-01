# Home 首页逻辑改进 - 实现总结

## 改进目标

根据产品口径 X，改进 Home 首页的"首屏展示 + 刷新 + 🆕 badge"逻辑：

1. **首屏默认只展示最近 3 天**的消息
2. 提供**"显示更早消息（本地）"**按钮
3. **🆕 badge** 只计实时新消息，回填消息不计入
4. **下拉刷新为轻刷新**，不重建订阅
5. 实时订阅持续工作，🆕能实时增长

## 核心实现

### 1. 状态管理 (Lines 205-206)

```typescript
const isBackfilling = ref(false); // 区分回填阶段 vs 实时阶段
const showOlderLocal = ref(false); // 是否显示更早的本地消息
```

### 2. 首屏加载优化 (Lines 846-857)

只显示最近3天的消息：

```typescript
const now = Math.floor(Date.now() / 1000);
const threeDaysAgo = now - THREE_DAYS_IN_SECONDS;

if (isInitialLoad.value) {
  const recentMessages = messagesRef.value.filter(
    m => (m.created_at || 0) >= threeDaysAgo
  );
  displayedMessages.value = recentMessages;
  logger.info(`初始加载: 仅显示最近3天的 ${displayedMessages.value.length} 条消息（共 ${messagesRef.value.length} 条本地缓存）`);
}
```

### 3. 回填逻辑改进 (Lines 877-889)

使用 await 确保回填完成再启动实时订阅：

```typescript
isBackfilling.value = true;
await backfillMessages(friendSet, relays);
isBackfilling.value = false;
logger.info("[回填完成] 切换到实时模式");
```

### 4. 区分回填和实时消息 (Lines 316-348)

在 `updateLocalRefs()` 中根据 `isBackfilling` 决定消息去向：

```typescript
if (isBackfilling.value) {
  // 回填阶段：直接显示，不计入🆕
  logger.info(`[回填阶段] 收到 ${othersMessages.length} 条其他用户的消息，直接显示（不计入🆕）`);
  // 合并到 displayedMessages
} else {
  // 实时阶段：进入 pending，计入🆕
  logger.info(`[实时阶段] 收到 ${othersMessages.length} 条其他用户的新消息，计入🆕等待刷新显示`);
  // 添加到 pendingMessages
}
```

### 5. 轻刷新实现 (Lines 358-363)

下拉刷新只合并 pending 消息：

```typescript
usePullToRefresh({
  onRefresh: async () => {
    logger.info("[轻刷新] 合并pending消息到显示列表");
    showPendingMessages();
  }
});
```

### 6. 显示更早消息功能 (Lines 249-268)

新增按钮和函数允许用户手动展开本地历史：

```typescript
function showOlderLocalMessages() {
  showOlderLocal.value = true;
  const displayedIds = new Set(displayedMessages.value.map(m => m.id));
  const olderMessages = allLocalMessages.filter(m => !displayedIds.has(m.id));
  displayedMessages.value = [...displayedMessages.value, ...olderMessages].sort(...);
}
```

UI 按钮：
```vue
<div v-if="!showOlderLocal && displayedMessages.length > 0">
  <button @click="showOlderLocalMessages">
    📜 显示更早消息（本地）
  </button>
</div>
```

## 关键技术要点

### 消息流转逻辑

```
初始加载 → 只显示3天内的消息
    ↓
回填阶段 (isBackfilling=true)
    ↓ 新消息
    └→ 直接加入 displayedMessages（不计入🆕）
    ↓
回填完成 → 切换到实时模式
    ↓
实时阶段 (isBackfilling=false)
    ↓ 自己的消息
    ├→ 立即加入 displayedMessages
    ↓ 他人的消息
    └→ 加入 pendingMessages（🆕+1）
    ↓
用户刷新/点击🆕
    └→ 合并 pendingMessages 到 displayedMessages（🆕清零）
```

### 去重策略

1. **显示列表内部无重复**：通过 `addMessageIfNew` 检查 `msgs.inbox`
2. **pending 和 displayed 互斥**：通过 Set 过滤已显示的消息
3. **本地历史展开**：使用 Set 过滤已显示的 ID

### 性能优化

1. **首屏过滤**：减少初始渲染的消息数量
2. **轻刷新**：避免重建 WebSocket 连接和重复回填
3. **高效合并**：已排序数组使用归并排序（O(n)）

## 验收标准达成情况

| 验收标准 | 实现方式 | 状态 |
|---------|---------|------|
| 首屏只显示3天消息 | 使用 filter + THREE_DAYS_IN_SECONDS | ✅ |
| 回填不导致🆕暴涨 | isBackfilling 标志区分阶段 | ✅ |
| 实时消息计入🆕 | 实时阶段进入 pendingMessages | ✅ |
| 下拉刷新不重建订阅 | 只调用 showPendingMessages | ✅ |
| 可显示更早消息 | showOlderLocalMessages 函数 + UI按钮 | ✅ |

## 日志输出

改进后的关键日志：

- `初始加载: 仅显示最近3天的 X 条消息（共 Y 条本地缓存）`
- `[回填阶段] 收到 X 条其他用户的消息，直接显示（不计入🆕）`
- `[回填完成] 切换到实时模式`
- `[实时阶段] 收到 X 条其他用户的新消息，计入🆕等待刷新显示`
- `[轻刷新] 合并pending消息到显示列表`
- `[显示更早消息] 合并本地缓存的更早消息`

## 文件变更

- **src/views/Home.vue**: 主要改动文件
  - 新增 2 个状态变量
  - 新增 1 个函数 (showOlderLocalMessages)
  - 修改 3 个函数 (updateLocalRefs, startSub, usePullToRefresh)
  - 新增 UI 按钮和样式

## 测试建议

参见 `IMPLEMENTATION_SUMMARY.md` 中的详细测试步骤。

关键测试点：
1. 清除缓存后首次加载，验证只显示3天
2. 观察回填过程，🆕不应增长
3. 等待实时消息，🆕应该增长
4. 执行下拉刷新，观察日志确认不重建订阅
5. 点击"显示更早消息"按钮，验证展开历史

## 潜在问题和注意事项

1. **时区问题**：使用 Unix timestamp (UTC) 计算3天，不受时区影响
2. **边界情况**：恰好3天前的消息可能因时间精度问题被过滤
3. **性能考虑**：如果本地缓存非常大（>1000条），filter 操作可能有性能影响
4. **竞态条件**：回填和实时订阅之间有时序保证（await backfill 再启动实时）

## 未来优化方向

1. 考虑添加"加载更多"按钮进行分页加载
2. 可以添加时间范围选择器（1天/3天/7天）
3. 考虑使用虚拟滚动优化大量消息的渲染性能
4. 可以添加消息搜索和过滤功能
