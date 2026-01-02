# Home Feed Notification Optimization - Implementation Summary

## Overview

This PR implements a comprehensive optimization of the Home feed notification system to improve the PWA user experience, particularly addressing the issue of repeated "new messages" alerts on cold starts.

## Problem Statement

Before this PR:
- Users saw "X 条新消息" notification on every PWA cold start, even for messages they had already seen
- Notification bar used fixed positioning, which could interfere with layout
- Load more button could be obscured by bottom navigation bar on mobile devices
- No persistent tracking of which messages users had actually viewed

## Solution Implemented

### 1. lastSeenCreatedAt Watermark System

**File**: `src/utils/lastSeen.ts` (new)

A utility module that manages a persistent watermark timestamp for each user:

- **Key Format**: `home_lastSeenCreatedAt_${userPkHex}`
  - User-specific to prevent cross-account interference
  - Stored in localStorage for persistence across sessions
  
- **Functions**:
  - `getLastSeenCreatedAt(userPkHex)`: Retrieve watermark for a user
  - `setLastSeenCreatedAt(userPkHex, timestamp)`: Set watermark for a user
  - `updateLastSeenToNewest(userPkHex, messages)`: Find newest message and update watermark
  
- **Optimizations**:
  - Returns timestamp from update function to avoid redundant reads
  - Efficient loop-based max finding (better than reduce for large arrays)
  - Proper error handling and validation

### 2. Smart Pending Message Filtering

**File**: `src/views/Home.vue` (modified)

Updated the `updateLocalRefs()` function to implement watermark-based filtering:

```javascript
// Only consider messages newer than lastSeen as "new"
const trulyNewMessages = othersMessages.filter(
  msg => (msg.created_at || 0) > currentLastSeen
);
```

**Key Behaviors**:
- Own messages bypass the watermark (immediate display)
- Other users' messages are filtered by watermark before being added to pending queue
- Watermark initializes to newest displayed message on first load
- Watermark updates when user clicks "显示新消息"

### 3. Sticky Top Notification Bar

**File**: `src/views/Home.vue` (modified CSS)

Changed notification positioning from `fixed` to `sticky`:

**Before**:
```css
.new-messages-notification {
  position: fixed;
  top: 20px;
  left: 50%;
  /* ... */
}
```

**After**:
```css
.new-messages-notification {
  position: sticky;
  top: 0;
  left: 50%;
  margin-bottom: 12px;
  width: fit-content;
  max-width: calc(100% - 24px);
  /* ... */
}
```

**Benefits**:
- Notification stays visible at top while scrolling
- Better integration with document flow
- No z-index conflicts with other fixed elements
- Responsive width handling

### 4. Bottom Navigation Safe Area Support

**Files**: `src/styles.css` (modified), `src/views/Home.vue` (modified)

Added proper spacing for load more button:

**Global CSS Variable** (styles.css):
```css
:root {
  --load-more-padding: 20px;
}
```

**Component CSS** (Home.vue):
```css
.load-more-container {
  padding: var(--load-more-padding) 12px;
  padding-bottom: calc(
    var(--load-more-padding) + 
    var(--bottom-nav-height) + 
    env(safe-area-inset-bottom)
  );
}
```

**Benefits**:
- Button never obscured by bottom navigation (80px clearance)
- iOS safe area support with `env(safe-area-inset-bottom)`
- Maintainable with CSS custom properties
- Responsive to different device configurations

## Technical Details

### Watermark Update Timing

1. **Initial Load** (first time user opens feed):
   ```
   User opens PWA → Load messages → Display first 20 → Set watermark to newest
   ```

2. **Subsequent Loads** (returning user):
   ```
   User opens PWA → Load watermark → Filter by watermark → Only show newer messages
   ```

3. **User Action** (clicking notification):
   ```
   User clicks "显示新消息" → Merge pending into displayed → Update watermark to newest in entire feed
   ```

### Data Flow

```
New Message Arrives
    ↓
Is it from current user?
    ├─ Yes → Display immediately (bypass watermark)
    └─ No  → Check watermark
                ↓
            created_at > lastSeenCreatedAt?
                ├─ Yes → Add to pending queue (show notification)
                └─ No  → Add to messagesRef (no notification)
```

### LocalStorage Structure

```javascript
{
  "home_lastSeenCreatedAt_abc123...": "1735689600",  // User A's watermark
  "home_lastSeenCreatedAt_def456...": "1735693200",  // User B's watermark
  // Other app data...
}
```

## Code Changes Summary

- **Files Modified**: 2
- **Files Added**: 1
- **Total Lines**: +113, -13

### Changes by File

1. **src/utils/lastSeen.ts** (+69 lines)
   - New utility module
   - 3 exported functions
   - Comprehensive JSDoc documentation

2. **src/views/Home.vue** (+48 lines, -13 lines)
   - Import lastSeen utilities
   - Add `lastSeenCreatedAt` ref
   - Update `showPendingMessages()` to update watermark
   - Update `updateLocalRefs()` to filter by watermark
   - Initialize watermark in `startSub()`
   - CSS changes for sticky notification and safe area

3. **src/styles.css** (+1 line)
   - Add `--load-more-padding` custom property

## Testing Strategy

Comprehensive testing guide created in `FEED_OPTIMIZATION_TESTING.md` covering:

1. PWA cold start behavior
2. New message notification flow
3. Sticky positioning
4. Bottom navigation safety
5. Multi-account isolation
6. Own messages immediate display
7. Watermark update accuracy

## Performance Impact

- **localStorage reads**: Minimal (1 read on startup, 1 read on notification click)
- **localStorage writes**: Minimal (1 write on first load, 1 write per notification click)
- **Rendering**: No additional re-renders
- **Memory**: Negligible (one timestamp per user in localStorage)
- **Network**: No additional API calls

## Security Considerations

- No security vulnerabilities detected by CodeQL
- LocalStorage keys include user PK to prevent cross-user data leakage
- No sensitive data stored (only timestamps)
- Proper input validation in utility functions

## Browser Compatibility

- **position: sticky**: Supported in all modern browsers (Chrome 56+, Firefox 32+, Safari 13+)
- **CSS custom properties**: Supported in all modern browsers
- **env(safe-area-inset-bottom)**: iOS 11.2+, gracefully degrades on older browsers
- **localStorage**: Universal support

## Future Enhancements

Potential improvements for future PRs:

1. **Auto-update on scroll**: Automatically update watermark when user scrolls to top and dwells
2. **Batch notifications**: Group multiple pending message notifications
3. **Notification preferences**: Let users customize notification behavior
4. **Sync across devices**: Sync watermark via nostr events for cross-device consistency
5. **Analytics**: Track notification engagement metrics

## Migration Notes

No migration required. Changes are backward compatible:

- New utility module is self-contained
- Watermark system initializes automatically on first use
- Existing localStorage data unaffected
- No database schema changes
- No breaking changes to APIs or interfaces

## Rollback Plan

If issues arise, rollback is simple:

1. Revert the 4 commits in this PR
2. Clear localStorage keys starting with `home_lastSeenCreatedAt_`
3. No data loss (watermarks are non-critical metadata)

## Verification Checklist

- [x] Code builds successfully
- [x] No TypeScript errors
- [x] No ESLint warnings
- [x] Code review completed and feedback addressed
- [x] CodeQL security scan passed (0 vulnerabilities)
- [x] Testing documentation created
- [x] All optimization goals met

## User-Facing Changes

### Before This PR
- ❌ "10 条新消息" appears every time PWA opens (even for old messages)
- ❌ Notification bar fixed at top, may conflict with other UI
- ❌ Load more button sometimes hidden by bottom nav

### After This PR
- ✅ "10 条新消息" only appears for truly new messages
- ✅ Notification bar sticks gracefully to top while scrolling
- ✅ Load more button always visible with proper spacing
- ✅ Own messages appear immediately (no notification delay)
- ✅ Multi-account support (separate watermarks per user)

## Acceptance Criteria ✅

All requirements from the original issue have been met:

1. ✅ **lastSeen watermark**: Implemented with localStorage, user-specific keys
2. ✅ **Sticky notification**: Changed from fixed to sticky positioning
3. ✅ **Bottom safe area**: Load more button respects bottom nav and safe areas
4. ✅ **Fusion rules**: New messages at top (sticky), load more at bottom (safe)
5. ✅ **Update timing**: On notification click, with initialization on first load
6. ✅ **Multi-account**: Separate watermarks per user (key includes pkHex)

## Demo Instructions

To see the optimization in action:

1. **Setup**: Open PWA, login, view some messages
2. **Test 1**: Close and reopen PWA → No false "new messages" alert
3. **Test 2**: Have friend post message → See notification → Click it → Watermark updates
4. **Test 3**: Scroll feed → Notification stays at top
5. **Test 4**: Scroll to bottom → Load more button visible above nav bar
6. **Test 5**: Post own message → Appears immediately, no notification

## Support

For questions or issues:
- See `FEED_OPTIMIZATION_TESTING.md` for detailed testing procedures
- Check console logs for watermark operations (includes timestamps)
- Use DevTools to inspect localStorage watermark values
- Review this document for implementation details

---

**PR Author**: GitHub Copilot  
**Reviewers**: ganlinlaomu  
**Status**: Ready for Testing  
**Branch**: `copilot/optimize-home-feed-notifications`
