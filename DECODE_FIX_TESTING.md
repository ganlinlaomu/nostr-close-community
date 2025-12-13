# Interaction Event Decoding Fix - Testing Guide

## Summary of Changes

This fix addresses the issue where interaction events (kind 24243) failed to decode due to incorrect `this` binding in Pinia store actions. The changes include:

1. **Extracted decode logic into standalone helper function**: `decodeInteractionEvent()` is now a standalone async function that doesn't rely on `this` context
2. **Improved logging**: Added comprehensive logging at each step of the decode/process pipeline
3. **Better error reporting**: Each failure case now logs specific reasons for failure

## Key Files Modified

- `src/stores/interactions.ts`: Main interaction store with decode helper function

## Expected Console Logs

### Successful Event Processing

When an interaction event is successfully decoded and stored, you should see logs like:

```
[info] [互动事件] 收到事件 c57dd8d8... pubkey=7ba5455a... created_at=1765588223
[info] [互动事件] 解码成功 c57dd8d8...: type=like, messageId=abc12345..., author=7ba5455a...
[info] [互动事件] 已写入store: like on messageId=abc12345... by 7ba5455a...
[debug] [互动存储] 已保存到Map: like on messageId=abc12345..., 该消息共有 1 个互动
```

### Failed Event Processing (with specific reasons)

When an event fails to decode, you'll see specific error messages:

```
[info] [互动事件] 收到事件 xyz789...
[warn] [互动事件] 解析失败 xyz789...: 无效的JSON内容
```

or

```
[info] [互动事件] 收到事件 xyz789...
[warn] [互动事件] 解析失败 xyz789...: 缺少keys或pkg字段
```

or

```
[info] [互动事件] 收到事件 xyz789...
[debug] [互动事件] 跳过事件 xyz789...: 不是发给当前用户的
```

### Duplicate Detection

When duplicate interactions are detected:

```
[debug] [互动事件] 跳过重复事件 c57dd8d8...
```

or

```
[debug] [互动存储] 跳过重复点赞: messageId=abc12345... author=7ba5455a...
```

## Testing Scenarios

### Scenario 1: Backfill with Authors Filter (Cross-Device Sync)

**Purpose**: Verify that self-interactions (likes/comments from the same user on other devices) are correctly fetched and decoded during backfill.

**Steps**:
1. On Device A, log in with Account A
2. Post a message and like it (self-like)
3. Log out or close Device A
4. On Device B (or new browser profile), log in with the same Account A
5. Wait for backfill to complete
6. Check if the self-like appears on Device B

**Expected Results**:
- ✅ Console shows: `回填互动过滤器 2/2: 发件箱 (authors)`
- ✅ Console shows: `[info] [互动事件] 收到事件 ...` for the self-like event
- ✅ Console shows: `[info] [互动事件] 解码成功 ...` 
- ✅ Console shows: `[info] [互动事件] 已写入store ...`
- ✅ The like count increases correctly on Device B
- ✅ The like is displayed in the UI

### Scenario 2: Real-Time Subscription

**Purpose**: Verify that real-time interaction events are correctly decoded.

**Steps**:
1. On Device A, log in with Account A and stay on the home page
2. On Device B, log in with Account B
3. On Device B, like a post from Account A
4. Observe Device A's console and UI

**Expected Results**:
- ✅ Console shows: `[info] [互动事件] 收到事件 ...` within seconds
- ✅ Console shows: `[info] [互动事件] 解码成功 ...`
- ✅ Console shows: `[info] [互动事件] 已写入store ...`
- ✅ The like appears immediately on Device A without refresh
- ✅ No error messages about `this.decodeInteractionEvent is not a function`

### Scenario 3: Invalid/Malformed Events

**Purpose**: Verify that invalid events are handled gracefully with clear error messages.

**Steps**:
This is more of a code inspection - the decode helper now has specific error handling for:
- Invalid JSON in event content
- Missing `keys` or `pkg` fields
- Events not targeted at the current user
- Failed NIP-04 decryption
- Missing required interaction fields (messageId, type)

**Expected Results**:
- ✅ Each failure case logs a specific, identifiable error message
- ✅ The error includes the event ID for debugging
- ✅ Processing continues for subsequent events without crashing

## Debugging with Enhanced Logs

### Enable Debug Logs

To see all debug-level logs, set in browser console:
```javascript
localStorage.setItem("nostr_debug", "1");
```
Then refresh the page.

### Check Log Prefixes

All interaction-related logs now use consistent prefixes:
- `[互动事件]` - Event reception and decoding
- `[互动存储]` - Storage operations and duplicate detection

### Verify Event Flow

For each interaction event, you should see this sequence:
1. `[互动事件] 收到事件 <id>` - Event received
2. `[互动事件] 解码成功 <id>` - Successfully decoded
3. `[互动事件] 已写入store` - Written to store
4. `[互动存储] 已保存到Map` - Saved to storage

If any step fails, there will be a warning/error log explaining why.

## Pre-Fix vs Post-Fix Behavior

### Pre-Fix (Problem)
```
[info] [互动事件] 收到事件 c57dd8d8...
[warn] [互动事件] 解码/处理失败 c57dd8d8... TypeError: this.decodeInteractionEvent is not a function
```
- Events were received but failed to decode
- No interactions appeared in the UI
- Cross-device sync was broken

### Post-Fix (Expected)
```
[info] [互动事件] 收到事件 c57dd8d8...
[info] [互动事件] 解码成功 c57dd8d8...
[info] [互动事件] 已写入store...
```
- Events are successfully decoded
- Interactions appear in the UI
- Cross-device sync works correctly

## Verification Checklist

After implementing this fix, verify:

- [ ] No errors about `this.decodeInteractionEvent is not a function`
- [ ] Backfill with authors filter successfully decodes self-interactions
- [ ] Real-time subscription correctly processes incoming interactions
- [ ] Console logs clearly show decode success/failure with reasons
- [ ] Invalid/malformed events are handled gracefully
- [ ] Interactions are correctly stored and displayed in the UI
- [ ] Cross-device sync works (self-likes appear on other devices)
- [ ] Duplicate detection still works correctly
- [ ] No performance degradation

## Manual Testing Commands

In browser console, you can inspect the interactions store:

```javascript
// Get the interactions store
const { useInteractionsStore } = await import('./src/stores/interactions');
const store = useInteractionsStore();

// Check processed events (dedupe set)
console.log('Processed events:', store.processedEvents.size);

// Check stored interactions
console.log('Interactions map:', store.interactions);

// Check last synced timestamp
console.log('Last synced at:', new Date(store.lastSyncedAt * 1000));
```

## Common Issues and Solutions

### Issue 1: Still seeing "is not a function" error
**Solution**: Clear browser cache and ensure the latest code is deployed.

### Issue 2: Events not being decoded
**Check**: 
- Verify the event has correct structure (keys, pkg fields)
- Check if the current user's pubkey is in the keys array
- Verify NIP-04 encryption/decryption is working

### Issue 3: Interactions appear then disappear
**Check**:
- Look for duplicate detection logs
- Verify the messageId matches the actual message
- Check localStorage for persisted interactions

## Notes

- The decode helper function is now completely independent of Pinia store context
- All `this` references have been eliminated from the decode path
- The function can be easily unit tested in isolation if needed
- Logging is consistent and uses prefixes for easy filtering
