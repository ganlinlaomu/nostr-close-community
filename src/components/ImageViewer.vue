<template>
  <transition name="fade">
    <div
      v-if="visible"
      class="image-viewer-overlay"
      @click="onOverlayClick"
      @keydown.esc="close"
      @keydown.left="previousImage"
      @keydown.right="nextImage"
      tabindex="0"
      ref="overlay"
    >
      <!-- Close button -->
      <button class="close-btn" @click="close" aria-label="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>

      <!-- Image counter -->
      <div v-if="images.length > 1" class="image-counter">
        {{ currentIndex + 1 }} / {{ images.length }}
      </div>

      <!-- Main image container -->
      <div class="image-container" @click.stop>
        <img
          v-if="currentImage"
          :src="currentImage"
          :alt="`图片 ${currentIndex + 1}`"
          class="viewer-image"
          :style="imageStyle"
          @click="toggleZoom"
          @load="onImageLoad"
          @error="onImageError"
        />
        <div v-if="loading" class="loading-spinner">加载中...</div>
        <div v-if="error" class="error-message">图片加载失败</div>
      </div>

      <!-- Navigation arrows (only show if multiple images) -->
      <template v-if="images.length > 1">
        <button
          class="nav-btn nav-btn-prev"
          @click.stop="previousImage"
          :disabled="currentIndex === 0"
          aria-label="上一张"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button
          class="nav-btn nav-btn-next"
          @click.stop="nextImage"
          :disabled="currentIndex === images.length - 1"
          aria-label="下一张"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </template>

      <!-- Thumbnail strip (for multiple images) -->
      <div v-if="images.length > 1" class="thumbnail-strip">
        <div
          v-for="(img, idx) in images"
          :key="idx"
          class="thumbnail"
          :class="{ active: idx === currentIndex }"
          @click.stop="goToImage(idx)"
        >
          <img :src="img" :alt="`缩略图 ${idx + 1}`" />
        </div>
      </div>
    </div>
  </transition>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from "vue";

export default defineComponent({
  name: "ImageViewer",
  props: {
    visible: {
      type: Boolean,
      required: true
    },
    images: {
      type: Array as () => string[],
      required: true
    },
    initialIndex: {
      type: Number,
      default: 0
    }
  },
  emits: ["close"],
  setup(props, { emit }) {
    const currentIndex = ref(0);
    const zoomed = ref(false);
    const loading = ref(true);
    const error = ref(false);
    const overlay = ref<HTMLElement | null>(null);

    const currentImage = computed(() => props.images[currentIndex.value] || null);

    const imageStyle = computed(() => {
      if (zoomed.value) {
        return {
          cursor: "zoom-out",
          maxWidth: "none",
          maxHeight: "none",
          width: "auto",
          height: "auto"
        };
      }
      return {
        cursor: "zoom-in"
      };
    });

    function close() {
      emit("close");
      zoomed.value = false;
    }

    function onOverlayClick(e: MouseEvent) {
      // Close when clicking on overlay (not on image)
      if (e.target === e.currentTarget) {
        close();
      }
    }

    function previousImage() {
      if (currentIndex.value > 0) {
        currentIndex.value--;
        zoomed.value = false;
        loading.value = true;
        error.value = false;
      }
    }

    function nextImage() {
      if (currentIndex.value < props.images.length - 1) {
        currentIndex.value++;
        zoomed.value = false;
        loading.value = true;
        error.value = false;
      }
    }

    function goToImage(index: number) {
      currentIndex.value = index;
      zoomed.value = false;
      loading.value = true;
      error.value = false;
    }

    function toggleZoom() {
      zoomed.value = !zoomed.value;
    }

    function onImageLoad() {
      loading.value = false;
      error.value = false;
    }

    function onImageError() {
      loading.value = false;
      error.value = true;
    }

    // Handle touch gestures for swipe
    let touchStartX = 0;
    let touchStartY = 0;

    function handleTouchStart(e: TouchEvent) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }

    function handleTouchEnd(e: TouchEvent) {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const deltaX = touchEndX - touchStartX;
      const deltaY = touchEndY - touchStartY;

      // Only handle horizontal swipes (ignore if vertical swipe is larger)
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        if (deltaX > 0) {
          // Swipe right - previous image
          previousImage();
        } else {
          // Swipe left - next image
          nextImage();
        }
      }
    }

    // Watch for visibility changes
    watch(() => props.visible, async (newVal) => {
      if (newVal) {
        currentIndex.value = props.initialIndex;
        zoomed.value = false;
        loading.value = true;
        error.value = false;
        
        await nextTick();
        
        // Focus overlay for keyboard events
        if (overlay.value) {
          overlay.value.focus();
        }

        // Add touch event listeners
        document.addEventListener("touchstart", handleTouchStart, { passive: true });
        document.addEventListener("touchend", handleTouchEnd, { passive: true });
      } else {
        // Remove touch event listeners
        document.removeEventListener("touchstart", handleTouchStart);
        document.removeEventListener("touchend", handleTouchEnd);
      }
    });

    onBeforeUnmount(() => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    });

    return {
      currentIndex,
      currentImage,
      zoomed,
      loading,
      error,
      overlay,
      imageStyle,
      close,
      onOverlayClick,
      previousImage,
      nextImage,
      goToImage,
      toggleZoom,
      onImageLoad,
      onImageError
    };
  }
});
</script>

<style scoped>
.image-viewer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  outline: none;
  overflow: hidden;
}

.close-btn {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 10;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.close-btn svg {
  width: 24px;
  height: 24px;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: scale(1.1);
}

.image-counter {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  color: white;
  background: rgba(0, 0, 0, 0.5);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  z-index: 10;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.image-container {
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.viewer-image {
  max-width: 100%;
  max-height: 90vh;
  object-fit: contain;
  display: block;
  transition: all 0.3s ease;
  user-select: none;
  -webkit-user-select: none;
}

.loading-spinner,
.error-message {
  color: white;
  font-size: 16px;
  text-align: center;
  padding: 20px;
}

.nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 10;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.nav-btn svg {
  width: 24px;
  height: 24px;
}

.nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-50%) scale(1.1);
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.nav-btn-prev {
  left: 20px;
}

.nav-btn-next {
  right: 20px;
}

.thumbnail-strip {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 8px;
  background: rgba(0, 0, 0, 0.5);
  padding: 8px;
  border-radius: 12px;
  max-width: 90vw;
  overflow-x: auto;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.thumbnail {
  width: 60px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
  flex-shrink: 0;
}

.thumbnail:hover {
  border-color: rgba(255, 255, 255, 0.5);
  transform: scale(1.05);
}

.thumbnail.active {
  border-color: white;
}

.thumbnail img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Mobile optimizations */
@media (max-width: 768px) {
  .close-btn,
  .nav-btn {
    width: 40px;
    height: 40px;
  }

  .close-btn svg,
  .nav-btn svg {
    width: 20px;
    height: 20px;
  }

  .close-btn {
    top: 10px;
    right: 10px;
  }

  .nav-btn-prev {
    left: 10px;
  }

  .nav-btn-next {
    right: 10px;
  }

  .image-counter {
    top: 10px;
    font-size: 12px;
    padding: 6px 12px;
  }

  .thumbnail-strip {
    bottom: 10px;
    padding: 6px;
    gap: 6px;
  }

  .thumbnail {
    width: 50px;
    height: 50px;
  }
}
</style>
