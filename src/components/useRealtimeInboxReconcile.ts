// components/useRealtimeInboxReconcile.ts
import { onMounted, onUnmounted } from "vue";

type ReconcileOptions = {
  /**
   * 强制对账函数
   * 👉 一般就是你现在的 updateLocalRefs()
   */
  reconcile: () => void | Promise<void>;

  /**
   * 是否已经可以开始对账
   * 👉 对应你现在的 readyForPending
   */
  isReady: () => boolean;

  /**
   * 是否启用调试日志
   */
  debug?: boolean;
};

export function useRealtimeInboxReconcile({
  reconcile,
  isReady,
  debug = false,
}: ReconcileOptions) {
  const log = (...args: any[]) => {
    if (debug) {
      console.info("[realtime-reconcile]", ...args);
    }
  };

  const safeReconcile = async (reason: string) => {
    if (!isReady()) {
      log("skip (not ready)", reason);
      return;
    }
    log("reconcile triggered by", reason);
    await reconcile();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      safeReconcile("visibilitychange");
    }
  };

  const onFocus = () => {
    safeReconcile("window.focus");
  };

  // iOS / bfcache / PWA 非常关键
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) {
      safeReconcile("pageshow (bfcache)");
    }
  };

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

    // 首次 mount 也跑一次，避免冷启动漏算
    safeReconcile("mounted");
  });

  onUnmounted(() => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pageshow", onPageShow);
  });
}