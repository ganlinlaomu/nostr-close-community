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

// 5. 注册 Service Worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((registration) => {
        console.log("[main] SW registered");
        // 每小时检查一次更新
        setInterval(() => registration.update(), 3600000); 
      })
      .catch((err) => console.warn("SW failed", err));
  });
}