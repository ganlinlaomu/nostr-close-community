<template>
  <div v-if="showUpdate" class="update-notification">
    <div class="update-content">
      <div class="update-icon">🔄</div>

      <div class="update-text">
        <h3>发现新版本</h3>
        <p>应用已有更新，刷新即可使用最新版本</p>
      </div>

      <button
        class="update-button"
        :disabled="updating"
        @click="updateApp"
      >
        {{ updating ? '更新中…' : '立即更新' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const showUpdate = ref(false);
const updating = ref(false);

let registration: ServiceWorkerRegistration | null = null;

/**
 * 检查是否真的有「新版本」
 * —— 只有 waiting SW 才算
 */
const checkForUpdate = async () => {
  if (!('serviceWorker' in navigator)) return;

  registration = await navigator.serviceWorker.ready;

  // 主动拉取更新（不会必然产生新版本）
  await registration.update();

  if (registration.waiting) {
    console.log('[PWA] New service worker waiting');
    showUpdate.value = true;
  }
};

/**
 * 用户点击「立即更新」
 */
const updateApp = async () => {
  if (!registration?.waiting) return;

  updating.value = true;

  // 通知 SW 跳过 waiting
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
};

/**
 * 新 SW 接管页面
 * —— 这是唯一该 reload 的地方
 */
const handleControllerChange = () => {
  console.log('[PWA] Controller changed, reloading page');
  window.location.reload();
};

onMounted(() => {
  if (!('serviceWorker' in navigator)) return;

  // 首次检测
  checkForUpdate();

  // 监听 SW 接管
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    handleControllerChange
  );

  // 可选：定时检测（生产建议 5~10 分钟）
  const interval = setInterval(checkForUpdate, 5 * 60 * 1000);

  onUnmounted(() => {
    clearInterval(interval);
    navigator.serviceWorker.removeEventListener(
      'controllerchange',
      handleControllerChange
    );
  });
});
</script>

<style scoped>
.update-notification {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: 9999;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: slideDown 0.25s ease-out;
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
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.update-icon {
  font-size: 28px;
  animation: rotate 2s linear infinite;
}

@keyframes rotate {
  to {
    transform: rotate(360deg);
  }
}

.update-text {
  flex: 1;
}

.update-text h3 {
  margin: 0 0 2px;
  font-size: 15px;
  font-weight: 600;
}

.update-text p {
  margin: 0;
  font-size: 13px;
  opacity: 0.9;
}

.update-button {
  background: #fff;
  color: #667eea;
  border: none;
  border-radius: 8px;
  padding: 8px 20px;
  font-weight: 600;
  cursor: pointer;
}

.update-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
