import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles.css";
import router from "./router";

// Polyfill for requestIdleCallback
if (typeof window !== 'undefined' && !('requestIdleCallback' in window)) {
  (window as any).requestIdleCallback = (callback: IdleRequestCallback) => {
    const start = Date.now();
    return setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
      });
    }, 1);
  };
  (window as any).cancelIdleCallback = (id: number) => {
    clearTimeout(id);
  };
}

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");

// register service worker for production
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(err => {
      console.warn('Service Worker 注册失败', err);
    });
  });
}
