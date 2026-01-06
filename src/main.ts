import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";
import router from "./router";

// 注意：在 main.ts 顶层尽量不要直接 useStore，因为 Pinia 还没挂载
import { clearExpiredCache } from "@/utils/imageCache";
import { initVersionTracking, handleVersionUpdate } from "@/utils/versionManager";

// 1. 检查版本变化（同步逻辑）
const versionChanged = initVersionTracking();
if (versionChanged) {
  console.log("[main] New version detected...");
  handleVersionUpdate().catch(console.error);
}

// 2. 初始化应用
const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// 3. 执行非阻塞的后台任务
// 这里的清理缓存可以放异步，因为它不影响核心渲染
(async () => {
  try {
    await clearExpiredCache();
  } catch (e) {
    console.warn("[main] clearExpiredCache failed", e);
  }
})();

// 4. 挂载应用
// 🔐 注意：真正的 restoreSession 逻辑建议完全移交给 App.vue 处理
// 这样可以利用 Vue 的生命周期钩子完美控制“加载中”状态
app.mount("#app");

// 5. 注册 Service Worker (环境感知版)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // 检查是否为开发环境 (Vite 默认环境变量)
    const isDev = import.meta.env.DEV;

    if (isDev) {
      // --- 开发环境逻辑：卸载 SW，确保调试顺畅 ---
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (let registration of registrations) {
          registration.unregister();
          console.log("[main] Dev mode detected: SW unregistered for better HMR");
        }
      });
    } else {
      // --- 生产环境逻辑：正式注册 ---
      navigator.serviceWorker
        .register("/service-worker.js") // 确保文件名与你实际的文件名一致
        .then((registration) => {
          console.log("[main] SW registered in Production");
          
          // 每小时检查一次更新
          setInterval(() => {
            registration.update();
            console.log("[main] Checking for SW updates...");
          }, 3600000); 
        })
        .catch((err) => console.warn("[main] SW registration failed", err));
    }
  });
}