<template>
  <div class="app-root">
    <UpdateNotification />
    
    <HeaderBar v-if="!isInitialLoading && ks.isLoggedIn" />
    
    <main class="main-content">
      <div v-if="isInitialLoading" class="app-loading">
        <div class="spinner"></div>
        <p>正在同步加密数据库...</p>
      </div>

      <router-view v-else v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <keep-alive :include="['Home', 'Friends', 'Notifications', 'Settings']">
            <component :is="Component" :key="ks.pkHex" />
          </keep-alive>
        </transition>
      </router-view>
    </main>
    
    <ToastContainer />
    <PostEditorModal />
  </div>
</template>

<script lang="ts" setup>
import { ref, onBeforeMount } from "vue";
import HeaderBar from "@/components/HeaderBar.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import PostEditorModal from "@/components/PostEditorModal.vue";
import UpdateNotification from "@/components/UpdateNotification.vue";
import { useKeyStore } from "@/stores/keys";

const ks = useKeyStore();
const isInitialLoading = ref(true);

onBeforeMount(async () => {
  try {
    // 运行初始化恢复逻辑
    await ks.init();
  } catch (err) {
    console.error("[App] 初始化失败:", err);
  } finally {
    // 标记初始化结束，展示路由内容
    isInitialLoading.value = false;
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
.app-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 80vh;
  color: #666;
}
.spinner {
  width: 40px; height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}
@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>