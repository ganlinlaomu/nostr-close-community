import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";
import router from "./router";

import { useKeyStore } from "@/stores/keys";
import { clearExpiredCache } from "@/utils/imageCache";
import { initVersionTracking, handleVersionUpdate } from "@/utils/versionManager";

// 1. 检查版本变化
const versionChanged = initVersionTracking();

if (versionChanged) {
  console.log("[main] New version detected, updating markers...");
  // 仅仅更新版本标记，不再执行导致 reload 的中断操作
  handleVersionUpdate().catch(console.error);
}

// 2. 正常初始化应用（无论是否更新，都必须加载）
const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.mount("#app");

// 3. 恢复会话和清理过期缓存
(async () => {
  const keys = useKeyStore();
  try {
    // 🔐 关键：确保即便版本更新，也能读取 localStorage 恢复私钥
    await keys.restoreSession();
  } catch (e) {
    console.error("[main] restoreSession failed", e);
  }
  
  try {
    await clearExpiredCache();
  } catch (e) {
    console.warn("[main] clearExpiredCache failed", e);
  }
})();

// 4. 注册 Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => {
        console.log("[main] Service Worker registered");
        setInterval(() => {
          registration.update();
        }, 60000);
      })
      .catch((err) => {
        console.warn("SW registration failed", err);
      });
  });
}
