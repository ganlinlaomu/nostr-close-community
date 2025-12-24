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

(async () => {
  // 🔑 在 mount 之前恢复登录态
  const keys = useKeyStore();

  try {
    await keys.restoreSession();
  } catch (e) {
    console.error("[main] restoreSession failed", e);
  }

  app.mount("#app");
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