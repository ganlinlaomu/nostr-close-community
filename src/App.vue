<template>
  <div class="app-root">
    <UpdateNotification />
    <HeaderBar v-if="ks.isLoggedIn" />
    
    <main class="main-content">
      <router-view v-slot="{ Component }" :key="ks.pkHex">
        <transition name="fade" mode="out-in">
          <div v-if="!isInitialLoading" :key="ks.pkHex">
            <keep-alive :include="['Home', 'Friends', 'Notifications', 'Settings']">
              <component :is="Component" />
            </keep-alive>
          </div>
          
          <div v-else class="app-loading">
            <div class="spinner"></div>
            <p>正在同步加密数据库...</p>
          </div>
        </transition>
      </router-view>
    </main>
    
    <ToastContainer />
    <PostEditorModal />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import HeaderBar from "@/components/HeaderBar.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import PostEditorModal from "@/components/PostEditorModal.vue";
import UpdateNotification from "@/components/UpdateNotification.vue";

// 引入相关的 Store
import { useKeyStore } from "@/stores/keys";
import { logger } from "@/utils/logger";

export default defineComponent({
  name: "App",
  components: { 
    HeaderBar, 
    ToastContainer, 
    PostEditorModal, 
    UpdateNotification 
  },
  
  setup() {
    const ks = useKeyStore();
    const isInitialLoading = ref(true);

    /**
     * 应用启动时的核心恢复逻辑
     */
    onBeforeMount(async () => {
      logger.info("[App] Initializing application state...");
      
      try {
        // 1. 尝试从本地存储恢复登录和数据库连接
        // 这一步会执行 dexie.ts 的 openDatabase
        await ks.restoreLogin();
      } catch (err) {
        logger.error("[App] Restore session failed:", err);
      } finally {
        // 2. 无论成功与否，关闭加载状态，允许路由渲染
        isInitialLoading.value = false;
        logger.info("[App] Application state restored.");
      }
    });

    return { 
      ks,
      isInitialLoading
    };
  }
});
</script>

<style scoped>
.app-root {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--bg-color, #f4f4f4);
}

.main-content {
  flex: 1;
  position: relative;
}

/* 简单的转场动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 加载界面样式 */
.app-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 80vh;
  color: #666;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>