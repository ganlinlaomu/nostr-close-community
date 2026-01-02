# Home Feed Optimization - Testing Guide

This document provides detailed testing instructions for the Home feed notification optimization features implemented in this PR.

## Features Implemented

1. **lastSeenCreatedAt Watermark System**: Prevents repeated "new messages" notifications on PWA cold starts
2. **Smart Pending Message Filtering**: Only shows truly new messages based on watermark
3. **Sticky Top Notification Bar**: Improved notification positioning
4. **Safe Area Support**: Load more button respects bottom navigation and iOS safe areas

## Testing Prerequisites

- Multiple user accounts for testing cross-user scenarios
- Device with bottom navigation bar (iOS recommended for safe area testing)
- Ability to post messages from different accounts

## Test Scenarios

### 1. PWA Cold Start - No False Alerts

**Purpose**: Verify that the watermark prevents repeated notifications for already-seen messages.

**Steps**:
1. Open PWA and login
2. View the home feed with existing messages
3. Note the timestamp of the newest message
4. Close the PWA completely (force close or restart browser)
5. Reopen the PWA

**Expected Result**:
- ✅ No "X 条新消息" notification should appear
- ✅ The feed should display normally without pending messages alert
- ✅ Console log should show: `初始化 lastSeenCreatedAt: [timestamp]`

**Failure Indicators**:
- ❌ "X 条新消息" notification appears for old messages
- ❌ Watermark not being initialized or read correctly

### 2. New Message Notification Flow

**Purpose**: Verify that new messages trigger the notification correctly.

**Steps**:
1. Open PWA as User A
2. Switch to another device/account (User B)
3. Post a new message as User B
4. Return to User A's PWA
5. Wait for message to arrive (should see pending notification)
6. Click on the "X 条新消息" notification

**Expected Result**:
- ✅ New message appears in pending notification
- ✅ Clicking notification merges it into the feed
- ✅ Console log shows: `更新 lastSeenCreatedAt: [new timestamp]`
- ✅ Watermark is updated to the new message's timestamp

**Verification**:
- Refresh or restart PWA - the same message should NOT appear as pending again

**Failure Indicators**:
- ❌ Notification doesn't appear for new messages
- ❌ Watermark not updated after clicking notification
- ❌ Same message appears as "new" after restart

### 3. Sticky Notification Bar Positioning

**Purpose**: Verify that the notification bar sticks to the top while scrolling.

**Steps**:
1. Open PWA with pending messages (notification visible)
2. Scroll down through the feed
3. Scroll back up to the top
4. Observe notification bar behavior

**Expected Result**:
- ✅ Notification bar should remain visible at the top while scrolling
- ✅ Bar should not overlap with HeaderBar (if present)
- ✅ Bar should have `position: sticky; top: 0;` in DevTools
- ✅ Bar should be centered horizontally

**Failure Indicators**:
- ❌ Notification disappears when scrolling
- ❌ Notification overlaps with other UI elements
- ❌ Notification not properly centered

### 4. Load More Button - Bottom Navigation Safety

**Purpose**: Verify that the load more button is not obscured by the bottom navigation bar.

**Steps**:
1. Open PWA with more than 20 messages (to enable pagination)
2. Scroll to the bottom of the feed
3. Observe the "加载更多" button position
4. Check on iOS device for safe area handling

**Expected Result**:
- ✅ Load more button is fully visible above bottom navigation
- ✅ Button has adequate spacing from bottom nav bar (80px + safe area)
- ✅ On iOS, button respects `env(safe-area-inset-bottom)`
- ✅ Button remains clickable without UI overlap

**Failure Indicators**:
- ❌ Button partially or fully hidden by bottom nav
- ❌ Button too close to bottom nav (hard to click)
- ❌ On iOS, button overlaps with home indicator area

### 5. Multi-Account Watermark Isolation

**Purpose**: Verify that different user accounts maintain separate watermarks.

**Steps**:
1. Login as User A, view feed, note newest message timestamp
2. Logout and login as User B
3. View feed, post new messages
4. Logout and login back as User A
5. Check if User A's watermark is preserved (no alerts for old messages)

**Expected Result**:
- ✅ Each user has independent `home_lastSeenCreatedAt_${pkHex}` in localStorage
- ✅ User A's watermark unchanged after User B's activity
- ✅ No cross-contamination of watermarks between accounts

**Verification using DevTools**:
```javascript
// Check localStorage
Object.keys(localStorage).filter(k => k.startsWith('home_lastSeenCreatedAt_'))
// Should show separate entries for each user's pkHex
```

**Failure Indicators**:
- ❌ Switching users shows false "new messages" for old content
- ❌ Watermarks overwrite each other
- ❌ Single watermark shared across accounts

### 6. Own Messages - Immediate Display

**Purpose**: Verify that messages posted by the current user appear immediately.

**Steps**:
1. Login and view home feed
2. Post a new message via PostEditor
3. Observe message appearance

**Expected Result**:
- ✅ Own message appears immediately in feed (no pending state)
- ✅ No "新消息" notification for own messages
- ✅ Message inserted at correct position (newest first)

**Failure Indicators**:
- ❌ Own message goes to pending queue
- ❌ Own message doesn't appear immediately
- ❌ Notification shown for own message

### 7. Watermark Update Accuracy

**Purpose**: Verify that watermark updates to the newest message in the entire feed.

**Steps**:
1. Open PWA with some existing messages
2. Receive multiple new messages (different timestamps)
3. Click "显示新消息"
4. Check watermark value in console

**Expected Result**:
- ✅ Watermark should be set to the NEWEST timestamp across all displayed messages
- ✅ Console log: `更新 lastSeenCreatedAt: [timestamp of newest message]`
- ✅ Subsequent restarts don't show any of those messages as pending

**Verification using DevTools**:
```javascript
// Check the watermark
const pkHex = 'your-public-key-hex';
const watermark = localStorage.getItem(`home_lastSeenCreatedAt_${pkHex}`);
console.log(new Date(parseInt(watermark) * 1000).toLocaleString());
// Compare with timestamps in feed
```

**Failure Indicators**:
- ❌ Watermark set to wrong timestamp (not the newest)
- ❌ Some messages still appear as "new" after viewing

## DevTools Debugging

### Checking Watermark Values

```javascript
// List all watermarks
Object.keys(localStorage)
  .filter(k => k.startsWith('home_lastSeenCreatedAt_'))
  .forEach(k => {
    const ts = parseInt(localStorage.getItem(k));
    console.log(k, ':', new Date(ts * 1000).toLocaleString());
  });
```

### Manually Setting Watermark

```javascript
// Set watermark to specific timestamp (for testing)
const pkHex = 'your-public-key-hex';
const timestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
localStorage.setItem(`home_lastSeenCreatedAt_${pkHex}`, timestamp.toString());
```

### Clearing Watermark

```javascript
// Reset watermark (will see all messages as "new")
const pkHex = 'your-public-key-hex';
localStorage.removeItem(`home_lastSeenCreatedAt_${pkHex}`);
```

## Expected Console Logs

When functioning correctly, you should see these log messages:

```
初始化 lastSeenCreatedAt: [date] or 未设置
首屏加载: 显示 20 条消息（共 X 条）
首次初始化 lastSeenCreatedAt: [date]  // Only on first ever load
收到 X 条其他用户的新消息（晚于 lastSeen），等待刷新显示
手动显示 X 条待显示消息
更新 lastSeenCreatedAt: [date]
```

## Common Issues and Solutions

### Issue: Notification always shows on restart
**Cause**: Watermark not being saved or read correctly
**Solution**: Check localStorage, verify pkHex is available when saving/reading

### Issue: Own messages go to pending queue
**Cause**: Logic error in updateLocalRefs filtering
**Solution**: Verify `msg.pubkey === keys.pkHex` check is working

### Issue: Load more button hidden
**Cause**: Bottom nav height or safe area not applied
**Solution**: Check CSS variables, verify padding calculation in DevTools

### Issue: Sticky notification not sticking
**Cause**: Browser doesn't support position: sticky or parent has overflow issues
**Solution**: Check computed styles, verify no parent has `overflow: hidden`

## Performance Verification

- Watermark read/write operations should be fast (<1ms)
- No noticeable lag when clicking "显示新消息"
- No unnecessary re-renders or API calls

## Accessibility Testing

- Notification should have proper ARIA labels
- Keyboard navigation should work (Tab to focus, Enter/Space to activate)
- Screen readers should announce "有 X 条新消息，点击查看"

## Browser Compatibility

Tested and expected to work on:
- Chrome/Edge 56+
- Firefox 32+
- Safari 13+ (iOS 13+)
- All modern PWA-capable browsers

---

## Test Sign-off Checklist

- [ ] Test 1: PWA Cold Start - No false alerts ✅
- [ ] Test 2: New message notification flow ✅
- [ ] Test 3: Sticky notification positioning ✅
- [ ] Test 4: Load more button safety ✅
- [ ] Test 5: Multi-account isolation ✅
- [ ] Test 6: Own messages immediate display ✅
- [ ] Test 7: Watermark update accuracy ✅
- [ ] Performance verification ✅
- [ ] Accessibility testing ✅
- [ ] Cross-browser testing ✅

**Tester Name**: _______________  
**Date**: _______________  
**Environment**: _______________  
**Issues Found**: _______________
