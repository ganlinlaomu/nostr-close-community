# PWA Testing Guide for 海内 (HaiNei)

## Testing Steps

### 1. Build and Preview
```bash
npm run build
npm run preview
```

### 2. Access the Application
- Open browser and navigate to the preview URL (shown in console, e.g., `http://localhost:4173/`)
- Open DevTools (F12)

### 3. Verify Service Worker Registration
1. Go to DevTools > Application tab > Service Workers
2. Verify that a service worker is registered for the current origin
3. Check that the service worker is in "activated" state

### 4. Verify Cache Storage
1. Go to DevTools > Application tab > Cache Storage
2. You should see caches created by Workbox:
   - `workbox-precache-v2-...` (contains precached app shell assets)
   - `google-fonts-cache` (if any Google Fonts are loaded)
3. Verify that the following files are cached:
   - `/index.html`
   - `/assets/index-*.js`
   - `/assets/index-*.css`
   - `/manifest.webmanifest`
   - `/icon-*.svg`

### 5. Test Offline Functionality
1. In DevTools > Network tab, enable "Offline" mode
2. Reload the page (Ctrl+R or Cmd+R)
3. **Expected Result**: The page should still load and display the UI (no white screen)
4. Navigate to Home page
5. **Expected Result**: The app should render without white screen

### 6. Verify Dexie IndexedDB Storage
1. Go to DevTools > Application tab > IndexedDB
2. You should see a database named `closed_community_db`
3. Expand it to see three object stores:
   - `messages` - stores inbox/outbox messages
   - `friends` - stores friends list
   - `meta` - stores metadata like sync timestamps

### 7. Test localStorage Migration
1. Before loading the app, add some test data to localStorage:
   ```javascript
   // In DevTools Console:
   localStorage.setItem('nostr_inbox_testpubkey', JSON.stringify([
     {id: 'test1', pubkey: 'testpk', created_at: Date.now()/1000, content: 'Test message 1'}
   ]));
   localStorage.setItem('nostr_friends_testpubkey', JSON.stringify({
     list: [{pubkey: 'friendpk1', name: 'Test Friend'}],
     lastSyncTimestamp: Date.now()/1000
   }));
   ```
2. Load the app and login with a test account (or the account matching the pubkey)
3. Check DevTools > Console for migration logs:
   - Should see "[Migration] Found X inbox messages..."
   - Should see "[Migration] Migrated X messages to Dexie"
   - Should see "[Migration] Removed localStorage key..."
4. Verify in Application tab > Local Storage that the old keys are removed
5. Verify in Application tab > IndexedDB > closed_community_db that the data was migrated

### 8. Test PWA Installation (Desktop)
1. In Chrome/Edge, look for the install icon in the address bar (⊕ or computer monitor icon)
2. Click it to install the PWA
3. Launch the installed app
4. **Expected Result**: App opens in standalone window without browser UI
5. Close the app
6. Enable airplane mode or disconnect network
7. Launch the installed PWA again
8. **Expected Result**: App loads successfully (offline-first)

### 9. Test First Login Empty Feed Issue (Breakpoint Fix)
1. Clear all application data:
   - DevTools > Application > Storage > Clear site data
   - Or clear IndexedDB, localStorage, and cache manually
2. Login to the app with your account
3. Navigate to Home page
4. Check DevTools Console for backfill logs
5. **Expected Result**: You should see:
   ```
   无断点，拉取最近3天: since=<3 days ago>
   回填完成: X 个事件, Y 个批次
   ```
6. If no messages were decrypted (e.g., no friends have posted), check for:
   ```
   跳过断点更新: 未解密任何消息 (获取了 X 条事件)
   ```
7. **Expected Result**: On next app reload/refresh, the backfill should retry the same 3-day window instead of being locked to a tiny time window
8. Post a test message yourself
9. **Expected Result**: Your own message should appear in the home feed (not filtered out)

### 10. Test PWA Installation (Mobile - Manual)
1. On Android Chrome:
   - Open the app in Chrome
   - Tap the three-dot menu
   - Select "Add to Home Screen"
   - Confirm installation
2. On iOS Safari:
   - Open the app in Safari
   - Tap the share button
   - Select "Add to Home Screen"
   - Confirm installation
3. Enable airplane mode
4. Launch the app from home screen
5. **Expected Result**: App loads successfully

## Verification Checklist

- [ ] Build completes without errors
- [ ] Service worker is registered and activated
- [ ] Assets are precached in Cache Storage
- [ ] App loads offline (no white screen)
- [ ] IndexedDB contains `closed_community_db` with three tables
- [ ] localStorage data is migrated to Dexie on first load
- [ ] Old localStorage keys are removed after migration
- [ ] Home page displays cached messages when offline
- [ ] Home page displays cached friends list when offline
- [ ] Home page displays user's own messages in feed
- [ ] First login without messages doesn't lock breakpoint to current time
- [ ] Subsequent logins can fetch historical messages after breakpoint fix
- [ ] PWA can be installed (desktop/mobile)
- [ ] Installed PWA works offline

## Expected Console Logs

When the app loads for the first time with existing localStorage data:
```
[Migration] Found X inbox messages in localStorage for <pubkey>
[Migration] Migrated X inbox messages to Dexie
[Migration] Removed localStorage key: nostr_inbox_<pubkey>
[Migration] Found Y friends in localStorage for <pubkey>
[Migration] Migrated Y friends to Dexie
[Migration] Removed localStorage key: nostr_friends_<pubkey>
[Messages] Loaded X inbox messages from Dexie
[Messages] Loaded Y outbox messages from Dexie
[Friends] Loaded Z friends from Dexie (timestamp: ...)
```

### Backfill Breakpoint Behavior

**On first login with no messages:**
```
无断点，拉取最近3天: since=<3 days ago timestamp>
回填完成: 0 个事件, 0 个批次
跳过断点更新: 未解密任何消息 (获取了 0 条事件)
```
Note: The breakpoint is NOT updated when no messages are decrypted. This allows subsequent logins to retry the full 3-day window.

**After friends post messages:**
```
使用断点拉取（限制3天）: since=<breakpoint+1>, breakpoint=<last successful timestamp>
回填完成: X 个事件, Y 个批次
保存消息断点: <newest message timestamp> (解密了 X 条)
```
Note: The breakpoint is only updated when at least one message is successfully decrypted.

## Troubleshooting

### Service Worker Not Registering
- Check browser console for errors
- Ensure you're accessing via HTTP/HTTPS (not file://)
- Clear browser cache and reload

### No Offline Support
- Verify service worker is in "activated" state
- Check Cache Storage contains the precached assets
- Try hard refresh (Ctrl+Shift+R)

### Migration Not Working
- Check console for migration errors
- Verify localStorage keys exist before app load
- Check IndexedDB to see if data was added

### White Screen When Offline
- Check if service worker is caching all required assets
- Verify index.html is in Cache Storage
- Check console for fetch errors

## Architecture Overview

### PWA Implementation
- **Plugin**: `vite-plugin-pwa` with Workbox
- **Service Worker**: Auto-generated by Workbox, precaches all build assets
- **Manifest**: Includes app metadata and SVG icons
- **Registration**: Handled by `virtual:pwa-register` in `src/main.ts`

### Dexie Implementation
- **Database**: `closed_community_db`
- **Tables**:
  - `messages`: Stores inbox/outbox messages with type field
  - `friends`: Stores friends list
  - `meta`: Stores metadata like sync timestamps
- **Migration**: One-time automatic migration from localStorage to Dexie
- **Cleanup**: Old localStorage keys removed after successful migration

### Offline-First Strategy
1. On app startup, stores load from Dexie first (instant display)
2. Then sync with relays in background (if online)
3. New data from relays is saved to Dexie for next offline session
4. Service worker caches all app shell assets for offline loading
