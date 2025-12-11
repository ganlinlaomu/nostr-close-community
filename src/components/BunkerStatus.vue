<template>
  <div v-if="shouldShow" class="bunker-status-container">
    <div 
      class="bunker-status"
      :class="statusClass"
      @click="handleClick"
    >
      <span class="status-icon">{{ statusIcon }}</span>
      <span class="status-text">{{ statusText }}</span>
      <button 
        v-if="canReconnect" 
        class="reconnect-btn"
        @click.stop="attemptReconnect"
        :disabled="reconnecting"
      >
        {{ reconnecting ? '连接中...' : '重新连接' }}
      </button>
    </div>
    <div v-if="showDetails && keyStore.bunkerLastError" class="error-details">
      {{ keyStore.bunkerLastError }}
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue';
import { useKeyStore } from '@/stores/keys';

export default defineComponent({
  name: 'BunkerStatus',
  setup() {
    const keyStore = useKeyStore();
    const showDetails = ref(false);
    const reconnecting = ref(false);

    const shouldShow = computed(() => {
      return keyStore.loginMethod === 'nip46';
    });

    const statusClass = computed(() => {
      switch (keyStore.bunkerConnectionStatus) {
        case 'connected':
          return 'status-connected';
        case 'connecting':
          return 'status-connecting';
        case 'error':
          return 'status-error';
        default:
          return 'status-disconnected';
      }
    });

    const statusIcon = computed(() => {
      switch (keyStore.bunkerConnectionStatus) {
        case 'connected':
          return '✓';
        case 'connecting':
          return '⟳';
        case 'error':
          return '⚠';
        default:
          return '○';
      }
    });

    const statusText = computed(() => {
      switch (keyStore.bunkerConnectionStatus) {
        case 'connected':
          return '远程签名器已连接';
        case 'connecting':
          return '正在连接签名器...';
        case 'error':
          return '签名器连接失败';
        default:
          return '签名器未连接';
      }
    });

    const canReconnect = computed(() => {
      return keyStore.bunkerConnectionStatus === 'error' || 
             keyStore.bunkerConnectionStatus === 'disconnected';
    });

    const handleClick = () => {
      if (keyStore.bunkerConnectionStatus === 'error') {
        showDetails.value = !showDetails.value;
      }
    };

    const attemptReconnect = async () => {
      if (reconnecting.value) return;
      
      const bunkerInput = localStorage.getItem('bunkerInput');
      if (!bunkerInput) {
        alert('未找到签名器配置，请重新登录');
        return;
      }

      reconnecting.value = true;
      try {
        await keyStore.loginWithBunker(bunkerInput);
        showDetails.value = false;
      } catch (e: any) {
        console.error('Reconnect failed:', e);
        alert(`重新连接失败: ${e.message || e}`);
      } finally {
        reconnecting.value = false;
      }
    };

    return {
      keyStore,
      shouldShow,
      statusClass,
      statusIcon,
      statusText,
      canReconnect,
      showDetails,
      reconnecting,
      handleClick,
      attemptReconnect,
    };
  },
});
</script>

<style scoped>
.bunker-status-container {
  margin-bottom: 12px;
}

.bunker-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  transition: all 0.2s;
  cursor: pointer;
}

.status-connected {
  background: #d1fae5;
  color: #065f46;
  border: 1px solid #a7f3d0;
}

.status-connecting {
  background: #dbeafe;
  color: #1e40af;
  border: 1px solid #bfdbfe;
}

.status-error {
  background: #fee2e2;
  color: #991b1b;
  border: 1px solid #fecaca;
}

.status-disconnected {
  background: #f1f5f9;
  color: #64748b;
  border: 1px solid #e2e8f0;
}

.status-icon {
  font-size: 16px;
  font-weight: bold;
}

.status-connecting .status-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.status-text {
  flex: 1;
}

.reconnect-btn {
  background: white;
  border: 1px solid currentColor;
  color: inherit;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.reconnect-btn:hover:not(:disabled) {
  background: currentColor;
  color: white;
}

.reconnect-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-details {
  margin-top: 8px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 12px;
  color: #991b1b;
  word-wrap: break-word;
}
</style>
