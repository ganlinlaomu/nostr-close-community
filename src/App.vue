<template>
  <div class="app-root">
    <UpdateNotification />
    
    <!-- 顶部 HeaderBar -->
    <HeaderBar v-if="!isInitialLoading && ks.isLoggedIn" />

    <main class="main-content">
      <div v-if="isInitialLoading" class="app-loading">
        <div class="spinner"></div>
        <p>正在同步加密数据库...</p>
      </div>

      <!-- RouterView + KeepAlive -->
    <router-view v-slot="{ Component }">
  <transition name="fade" mode="out-in">
    <keep-alive :include="['Home','Friends','Notifications','Settings']">
      <component :is="Component" :key="$route.fullPath" />
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
    await ks.init();
  } catch (err) {
    console.error("[App] 初始化失败:", err);
  } finally {
    isInitialLoading.value = false;
  }
});
</script>