# 账号切换问题修复说明

## 问题描述

在浏览器上一个账号登出后，另一个账号登入会看到之前账号的信息。同时，自己的信息可能会出现重复的信息。

## 根本原因

1. **Interactions Store 缺少 reset() 方法**
   - 登出时，interactions store 的内存状态没有被清空
   - 新用户登录时，可能看到旧用户的点赞和评论信息

2. **Notifications Store 完全没有用户隔离**
   - 通知数据没有按用户分开存储在 localStorage
   - 所有用户共享同一个通知列表
   - 登出/登入不会清空或加载正确的通知

3. **消息显示逻辑存在重复问题**
   - Home.vue 中的消息合并逻辑没有去重
   - 当消息从不同来源（本地存储、实时订阅）到达时，可能出现重复

## 修复方案

### 1. Interactions Store 修复 (`src/stores/interactions.ts`)

**添加的功能：**
- 新增 `reset(removeFromStorage)` 方法
  - 清空内存中的 interactions Map
  - 清空 processedEvents Set
  - 重置 lastSyncedAt
  - 可选地从 localStorage 删除数据

**代码变更：**
```typescript
reset(removeFromStorage = false) {
  this.interactions.clear();
  this.processedEvents.clear();
  this.lastSyncedAt = 0;
  
  if (removeFromStorage) {
    try {
      const key = useKeyStore();
      if (key.pkHex) {
        const storageKey = `interactions_${key.pkHex}`;
        localStorage.removeItem(storageKey);
      }
    } catch (e) {
      logger.warn("Failed to remove interactions from storage", e);
    }
  }
}
```

### 2. Notifications Store 修复 (`src/stores/notifications.ts`)

**添加的功能：**
- 使用 per-user localStorage keys: `nostr_notifications_${pk}`
- 添加 `loadedFor` 状态追踪当前加载的用户
- 新增 `load(pk?)` 方法 - 加载指定用户的通知
- 新增 `save()` 方法 - 保存当前用户的通知
- 新增 `reset(removeFromStorage)` 方法 - 清空并可选删除存储
- 修改所有修改操作（`addNotification`, `markAsRead`, `markAllRead`）自动调用 `save()`

**关键代码变更：**
```typescript
function notificationsKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_notifications_${pk}`;
}

state: () => ({
  list: [] as NotificationItem[],
  loadedFor: "" as string,  // 新增
}),

async load(pk?: string) {
  const ks = useKeyStore();
  const targetPk = pk ?? ks.pkHex;
  if (!targetPk) {
    this.list = [];
    this.loadedFor = "";
    return;
  }
  if (this.loadedFor === targetPk) return;
  this.loadedFor = targetPk;

  try {
    const key = notificationsKeyFor(targetPk);
    if (key) {
      const raw = localStorage.getItem(key);
      this.list = raw ? JSON.parse(raw) : [];
    } else {
      this.list = [];
    }
  } catch {
    this.list = [];
  }
}
```

### 3. Keys Store 修复 (`src/stores/keys.ts`)

**添加的导入：**
```typescript
import { useInteractionsStore } from "./interactions";
import { useNotificationsStore } from "./notifications";
```

**更新的方法：**
- `loginWithSk()` - 添加 interactions 和 notifications 加载
- `loginWithExtension()` - 添加 interactions 和 notifications 加载
- `loginWithBunker()` - 添加 interactions 和 notifications 加载
- `loginWithNsec()` - 添加 interactions 和 notifications 加载
- `unlockWithPassword()` - 添加 interactions 和 notifications 加载
- `restoreSession()` - 添加 interactions 和 notifications 加载
- `logout()` - 添加 interactions 和 notifications 重置

**示例代码（loginWithSk）：**
```typescript
try {
  const interactions = useInteractionsStore();
  await interactions.load();
} catch {}
try {
  const notifications = useNotificationsStore();
  await notifications.load(this.pkHex);
} catch {}
```

**示例代码（logout）：**
```typescript
try {
  const interactions = useInteractionsStore();
  interactions.reset(false);
} catch {}
try {
  const notifications = useNotificationsStore();
  notifications.reset(false);
} catch {}
```

### 4. Home.vue 消息去重修复 (`src/views/Home.vue`)

**修复位置：**
1. `showPendingMessages()` 函数 - 显示待处理消息时
2. `updateLocalRefs()` 函数 - 合并自己的消息时

**去重策略：**
- 使用 `Set<string>` 追踪已经添加的消息 ID
- 在合并排序的同时，检查消息 ID 是否已存在
- 只添加未见过的消息

**示例代码：**
```typescript
const merged: any[] = [];
const seenIds = new Set<string>();
let i = 0, j = 0;
while (i < sortedPending.length || j < displayedMessages.value.length) {
  // ... 合并逻辑 ...
  if ((sortedPending[i].created_at || 0) >= (displayedMessages.value[j].created_at || 0)) {
    if (!seenIds.has(sortedPending[i].id)) {
      merged.push(sortedPending[i]);
      seenIds.add(sortedPending[i].id);
    }
    i++;
  } else {
    if (!seenIds.has(displayedMessages.value[j].id)) {
      merged.push(displayedMessages.value[j]);
      seenIds.add(displayedMessages.value[j].id);
    }
    j++;
  }
}
```

## 测试步骤

### 测试 1：账号切换后数据隔离

1. 使用账号 A 登录
2. 发送一些消息，添加一些点赞和评论
3. 登出账号 A
4. 使用账号 B 登录
5. **预期结果：**
   - 不应该看到账号 A 的消息
   - 不应该看到账号 A 的点赞和评论
   - 不应该看到账号 A 的通知
   - Home 页面应该是空的或只显示账号 B 的内容

### 测试 2：账号切换后通知隔离

1. 使用账号 A 登录，接收一些通知
2. 登出账号 A
3. 使用账号 B 登录
4. **预期结果：**
   - 通知列表应该是空的或只显示账号 B 的通知
   - 通知数量不应该是账号 A 的数量

### 测试 3：消息不重复

1. 登录账号
2. 发送一条消息
3. 等待消息从不同来源（本地、实时订阅）到达
4. **预期结果：**
   - 消息只应该出现一次
   - 不应该有重复的消息卡片

### 测试 4：回到原账号数据恢复

1. 使用账号 A 登录，发送一些消息
2. 登出账号 A
3. 使用账号 B 登录
4. 登出账号 B
5. 重新使用账号 A 登录
6. **预期结果：**
   - 应该能看到账号 A 之前的消息
   - 应该能看到账号 A 的点赞、评论和通知
   - 数据应该完整恢复

## 技术细节

### localStorage 键命名规范

现在所有 store 都使用一致的 per-user 键命名：

- Messages: `nostr_inbox_${pkHex}`, `nostr_outbox_${pkHex}`
- Interactions: `interactions_${pkHex}`
- Notifications: `nostr_notifications_${pkHex}` (新)
- LastSeen: `home_lastSeenCreatedAt_${pkHex}`
- Backfill: `backfill_breakpoint_messages_${pkHex}`, `backfill_breakpoint_interactions_${pkHex}`

### 内存状态管理

所有 store 现在都支持：
- `load(pk?)` - 加载指定用户的数据
- `save()` 或自动保存 - 保存当前用户的数据
- `reset(removeFromStorage)` - 清空内存状态，可选删除持久化数据
- `loadedFor` 状态 - 追踪当前加载的用户，避免重复加载

### 去重机制

使用 `Set<string>` 基于消息 ID 进行去重，而不是使用 `created_at + id` 的复合键，因为：
- Nostr 的事件 ID 已经是事件内容的哈希，天然唯一
- 更简单高效
- 避免了时间戳可能的精度问题

## 潜在影响

1. **兼容性**
   - 新代码向后兼容
   - 旧用户的数据不会丢失
   - notifications store 从无存储升级到有存储，对旧数据无影响

2. **性能**
   - 去重逻辑增加了 Set 操作，但时间复杂度仍为 O(n)
   - 内存占用略有增加（Set 存储 ID）
   - per-user 存储使得每个用户的数据更小，实际上可能提高加载速度

3. **存储空间**
   - 每个用户的数据单独存储，总体存储空间可能略有增加
   - 但每个用户的数据是隔离的，更加安全

## 后续改进建议

1. **数据迁移工具**
   - 如果需要，可以添加迁移脚本帮助用户清理旧数据

2. **存储清理**
   - 可以添加工具清理不再使用的账号数据
   - 可以在设置中显示各账号的存储占用

3. **单元测试**
   - 添加针对 store reset/load 方法的单元测试
   - 添加消息去重逻辑的单元测试

4. **集成测试**
   - 添加端到端的账号切换测试
   - 自动化测试数据隔离场景
