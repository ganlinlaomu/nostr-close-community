<template>
  <div ref="containerRef" class="pull-to-refresh-container">
    <div 
      ref="refresherRef" 
      class="pull-to-refresh-indicator" 
      :style="{ height: `${pullDistance}px`, opacity: pullDistance > 0 ? 1 : 0 }"
    >
      <div class="refresh-content">
        <span v-if="!isRefreshing && pullDistance < threshold" class="pull-icon">↓</span>
        <span v-else-if="!isRefreshing && pullDistance >= threshold" class="release-icon">↑</span>
        <span v-else class="loading-spinner">⟳</span>
        <span class="pull-text">
          {{ isRefreshing ? refreshingText : (pullDistance >= threshold ? releaseText : pullText) }}
        </span>
      </div>
    </div>
    <div ref="contentRef" class="pull-to-refresh-content">
      <slot></slot>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount } from "vue";

export default defineComponent({
  name: "PullToRefresh",
  props: {
    threshold: {
      type: Number,
      default: 80
    },
    maxDistance: {
      type: Number,
      default: 120
    },
    pullText: {
      type: String,
      default: "下拉刷新"
    },
    releaseText: {
      type: String,
      default: "释放刷新"
    },
    refreshingText: {
      type: String,
      default: "刷新中..."
    }
  },
  emits: ["refresh"],
  setup(props, { emit }) {
    const containerRef = ref<HTMLElement | null>(null);
    const contentRef = ref<HTMLElement | null>(null);
    const refresherRef = ref<HTMLElement | null>(null);
    
    const pullDistance = ref(0);
    const isRefreshing = ref(false);
    const startY = ref(0);
    const isPulling = ref(false);

    const canPull = (): boolean => {
      // Only allow pull-to-refresh when at the top of the scroll container
      const container = containerRef.value;
      if (!container) return false;
      
      // Check if the container is scrolled to the top
      return container.scrollTop === 0;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (!canPull() || isRefreshing.value) return;
      
      startY.value = e.touches[0].clientY;
      isPulling.value = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling.value || isRefreshing.value) return;
      
      const currentY = e.touches[0].clientY;
      const distance = currentY - startY.value;
      
      // Only pull down (positive distance) and when at top
      if (distance > 0 && canPull()) {
        // Apply resistance - the further you pull, the harder it gets
        const resistance = 0.5;
        let adjustedDistance = distance * resistance;
        
        // Cap at maxDistance
        adjustedDistance = Math.min(adjustedDistance, props.maxDistance);
        
        pullDistance.value = adjustedDistance;
        
        // Prevent default scrolling when pulling
        if (adjustedDistance > 10) {
          e.preventDefault();
        }
      } else {
        pullDistance.value = 0;
      }
    };

    const handleTouchEnd = () => {
      if (!isPulling.value || isRefreshing.value) return;
      
      isPulling.value = false;
      
      // If pulled beyond threshold, trigger refresh
      if (pullDistance.value >= props.threshold) {
        isRefreshing.value = true;
        emit("refresh", finishRefresh);
      } else {
        // Snap back
        pullDistance.value = 0;
      }
    };

    const finishRefresh = () => {
      isRefreshing.value = false;
      pullDistance.value = 0;
    };

    onMounted(() => {
      const container = containerRef.value;
      if (!container) return;
      
      container.addEventListener("touchstart", handleTouchStart, { passive: true });
      container.addEventListener("touchmove", handleTouchMove, { passive: false });
      container.addEventListener("touchend", handleTouchEnd, { passive: true });
    });

    onBeforeUnmount(() => {
      const container = containerRef.value;
      if (!container) return;
      
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    });

    return {
      containerRef,
      contentRef,
      refresherRef,
      pullDistance,
      isRefreshing
    };
  }
});
</script>

<style scoped>
.pull-to-refresh-container {
  position: relative;
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.pull-to-refresh-indicator {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
  background: linear-gradient(to bottom, #f7fafc, rgba(247, 250, 252, 0));
  z-index: 1;
}

.refresh-content {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #64748b;
  font-size: 14px;
}

.pull-icon,
.release-icon {
  font-size: 20px;
  transition: transform 0.3s;
}

.release-icon {
  color: #1976d2;
}

.loading-spinner {
  font-size: 20px;
  animation: spin 1s linear infinite;
  color: #1976d2;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.pull-text {
  font-weight: 500;
}

.pull-to-refresh-content {
  position: relative;
}
</style>
