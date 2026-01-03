<template>
  <div v-if="showUpdate" class="update-notification">
    <div class="update-content">
      <div class="update-icon">🔄</div>
      <div class="update-text">
        <h3>发现新版本</h3>
        <p>{{ message }}</p>
      </div>
      <button @click="handleUpdate" class="update-button">
        {{ updating ? '更新中...' : '立即更新' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { handleVersionUpdate } from '@/utils/versionManager';

const showUpdate = ref(false);
const updating = ref(false);
const message = ref('应用已更新到新版本，点击刷新以获得最佳体验');

let swRegistration: ServiceWorkerRegistration | null = null;

// Check for pending update messages before component mount
const PENDING_UPDATE_KEY = '_pending_sw_update';
const UPDATING_IN_PROGRESS_KEY = '_update_in_progress';

const handleUpdate = async () => {
  updating.value = true;
  
  try {
    // Set flag to prevent SW events from re-showing notification during update
    sessionStorage.setItem(UPDATING_IN_PROGRESS_KEY, 'true');
    
    // Also set a timestamp to ignore SW messages for a while after reload
    sessionStorage.setItem('_update_timestamp', Date.now().toString());
    
    // Handle version update (clear old caches, etc.)
    await handleVersionUpdate();
    
    // Clear pending update flag
    sessionStorage.removeItem(PENDING_UPDATE_KEY);
    
    // Wait a moment for cleanup to complete
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Force reload the page
    // Note: UPDATING_IN_PROGRESS_KEY stays set through reload,
    // preventing notification from showing again
    window.location.reload();
  } catch (e) {
    console.error('[UpdateNotification] Update failed', e);
    updating.value = false;
    message.value = '更新失败，请手动刷新页面';
    // Clear the flag on failure so user can try again
    sessionStorage.removeItem(UPDATING_IN_PROGRESS_KEY);
    sessionStorage.removeItem('_update_timestamp');
  }
};

const checkForUpdates = () => {
  if (!('serviceWorker' in navigator)) return;
  
  navigator.serviceWorker.ready.then(registration => {
    swRegistration = registration;
    
    // Check for updates periodically
    registration.update();
  });
};

const handleSWMessage = (event: MessageEvent) => {
  // Don't respond to SW events if update is already in progress
  if (sessionStorage.getItem(UPDATING_IN_PROGRESS_KEY) === 'true') {
    console.log('[UpdateNotification] Update in progress, ignoring SW message');
    return;
  }
  
  if (event.data && event.data.type === 'SW_UPDATED') {
    console.log('[UpdateNotification] SW updated', event.data);
    showUpdate.value = true;
    // Store the update state in case page reloads before user sees it
    sessionStorage.setItem(PENDING_UPDATE_KEY, 'true');
  }
};

const handleControllerChange = () => {
  // Don't respond to controller changes if update is already in progress
  if (sessionStorage.getItem(UPDATING_IN_PROGRESS_KEY) === 'true') {
    console.log('[UpdateNotification] Update in progress, ignoring controller change');
    return;
  }
  
  console.log('[UpdateNotification] Controller changed - new SW active');
  // Don't auto-reload, let user choose
  showUpdate.value = true;
  sessionStorage.setItem(PENDING_UPDATE_KEY, 'true');
};

onMounted(() => {
  // If update is in progress, clear it now (fresh page after reload)
  // and don't show any notification
  if (sessionStorage.getItem(UPDATING_IN_PROGRESS_KEY) === 'true') {
    console.log('[UpdateNotification] Clearing update-in-progress flag after reload');
    sessionStorage.removeItem(UPDATING_IN_PROGRESS_KEY);
    sessionStorage.removeItem(PENDING_UPDATE_KEY);
    sessionStorage.removeItem('_update_timestamp');
    return; // Don't show notification
  }
  
  // Check if we just completed a user-triggered update (within last 10 seconds)
  const updateTimestamp = sessionStorage.getItem('_update_timestamp');
  if (updateTimestamp) {
    const timeSinceUpdate = Date.now() - parseInt(updateTimestamp);
    if (timeSinceUpdate < 10000) { // 10 seconds grace period
      console.log('[UpdateNotification] Recently updated, ignoring pending updates');
      sessionStorage.removeItem(PENDING_UPDATE_KEY);
      sessionStorage.removeItem('_update_timestamp');
      return; // Don't show notification
    }
    // Clean up old timestamp
    sessionStorage.removeItem('_update_timestamp');
  }
  
  // Check if there was a pending update before mount
  if (sessionStorage.getItem(PENDING_UPDATE_KEY) === 'true') {
    console.log('[UpdateNotification] Found pending update from before mount');
    showUpdate.value = true;
  }
  
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleSWMessage);
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    
    // Check for updates on mount
    checkForUpdates();
    
    // Check for updates every 60 seconds
    const updateInterval = setInterval(checkForUpdates, 60000);
    
    // Cleanup on unmount
    onUnmounted(() => {
      clearInterval(updateInterval);
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    });
  }
});
</script>

<style scoped>
.update-notification {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 9999;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    transform: translateY(-100%);
  }
  to {
    transform: translateY(0);
  }
}

.update-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.update-icon {
  font-size: 32px;
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.update-text {
  flex: 1;
  min-width: 0;
}

.update-text h3 {
  margin: 0 0 4px 0;
  font-size: 16px;
  font-weight: 600;
}

.update-text p {
  margin: 0;
  font-size: 14px;
  opacity: 0.9;
}

.update-button {
  padding: 10px 24px;
  background: white;
  color: #667eea;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.update-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
}

.update-button:active {
  transform: translateY(0);
}

.update-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Mobile responsive */
@media (max-width: 640px) {
  .update-content {
    flex-wrap: wrap;
    padding: 12px 16px;
  }
  
  .update-icon {
    font-size: 24px;
  }
  
  .update-text h3 {
    font-size: 14px;
  }
  
  .update-text p {
    font-size: 12px;
  }
  
  .update-button {
    width: 100%;
    margin-top: 8px;
  }
}
</style>
