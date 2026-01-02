import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";
import router from "./router";

import { useKeyStore } from "@/stores/keys";

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// 🚀 优先渲染：先 mount，再恢复会话（避免首屏白屏）
app.mount("#app");

// 异步恢复登录态，不阻塞首屏渲染
(async () => {
  const keys = useKeyStore();
  try {
    await keys.restoreSession();
  } catch (e) {
    console.error("[main] restoreSession failed", e);
  }
})();

// register service worker for production
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .catch((err) => {
        console.warn("Service Worker 注册失败", err);
      });
  });
}