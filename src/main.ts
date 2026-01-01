import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";
import router from "./router";
import { registerSW } from "virtual:pwa-register";

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

// Register PWA service worker
const updateSW = registerSW({
  onNeedRefresh() {
    console.log("New content available, please refresh.");
  },
  onOfflineReady() {
    console.log("App ready to work offline.");
  }
});
