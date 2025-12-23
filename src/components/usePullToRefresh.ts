import { ref, onMounted, onBeforeUnmount } from "vue";
import { logger } from "@/utils/logger";

type PullOptions = {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  maxPull?: number;
};

export function usePullToRefresh(options: PullOptions) {
  const {
    onRefresh,
    threshold = 60,
    maxPull = 100
  } = options;

  const container = ref<HTMLElement | null>(null);
  const startY = ref(0);
  const pullDistance = ref(0);
  const refreshing = ref(false);

  function onTouchStart(e: TouchEvent) {
    if (refreshing.value) return;
    if (container.value?.scrollTop !== 0) return;

    startY.value = e.touches[0].clientY;
  }

  function onTouchMove(e: TouchEvent) {
    if (refreshing.value) return;
    if (container.value?.scrollTop !== 0) return;

    const dy = e.touches[0].clientY - startY.value;
    if (dy <= 0) return;

    pullDistance.value = Math.min(dy, maxPull);
  }

  async function onTouchEnd() {
    if (pullDistance.value >= threshold && !refreshing.value) {
       pullDistance.value = threshold;
       await triggerRefresh();
    }
    pullDistance.value = 0;
  }

  async function triggerRefresh() {
    if (refreshing.value) return;

    refreshing.value = true;
    logger.info("[PWA] pull to refresh");

    try {
      await onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      refreshing.value = false;
      pullDistance.value = 0;
    }
  }

  onMounted(() => {
    const el = container.value;
    if (!el) return;

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
  });

  onBeforeUnmount(() => {
    const el = container.value;
    if (!el) return;

    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
  });

  return {
    container,
    pullDistance,
    refreshing,
    triggerRefresh // ⭐ 可手动调用（如按钮 / resume）
  };
}