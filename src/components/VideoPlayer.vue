<template>
  <div class="video-player-container">
    <!-- Lazy loading: show poster/thumbnail until user clicks -->
    <div v-if="!playerLoaded" class="video-poster" @click="loadPlayer" @keyup.enter="loadPlayer" tabindex="0" role="button" :aria-label="`播放视频 - ${videoData.provider}`">
      <div class="poster-content">
        <div class="play-button">▶</div>
        <div class="video-meta">
          <div class="provider-badge">{{ videoData.provider }}{{ isEncrypted ? ' 🔒' : '' }}</div>
          <div class="video-url-display">{{ truncateUrl(displayUrl) }}</div>
        </div>
      </div>
    </div>

    <!-- Decryption progress -->
    <div v-else-if="decrypting" class="decryption-progress">
      <div class="progress-content">
        <div class="progress-spinner">⏳</div>
        <div class="progress-text">{{ decryptStatus }}</div>
        <div class="progress-bar-container">
          <div class="progress-bar" :style="{ width: decryptProgress + '%' }"></div>
        </div>
        <div class="progress-percent">{{ Math.round(decryptProgress) }}%</div>
      </div>
    </div>

    <!-- Decryption error -->
    <div v-else-if="decryptError" class="decryption-error">
      <div class="error-content">
        <div class="error-icon">⚠️</div>
        <div class="error-message">{{ decryptError }}</div>
        <button class="retry-button" @click="retryDecryption">重试</button>
      </div>
    </div>

    <!-- Player loaded: show video element with decrypted blob -->
    <div v-else-if="decryptedVideoUrl" class="video-player">
      <video
        :src="decryptedVideoUrl"
        controls
        class="video-element"
        preload="metadata"
      >
        您的浏览器不支持视频播放。
      </video>
    </div>

    <!-- Fallback for external embeds (YouTube, Vimeo) -->
    <div v-else-if="videoData.embedUrl && !isEncrypted" class="video-player">
      <!-- YouTube embed -->
      <iframe
        v-if="videoData.provider === 'YouTube'"
        :src="videoData.embedUrl"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        class="video-iframe"
      ></iframe>

      <!-- Vimeo embed -->
      <iframe
        v-else-if="videoData.provider === 'Vimeo'"
        :src="videoData.embedUrl"
        frameborder="0"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        class="video-iframe"
      ></iframe>

      <!-- Direct video -->
      <video
        v-else
        :src="videoData.embedUrl"
        controls
        class="video-element"
        preload="metadata"
      >
        您的浏览器不支持视频播放。
      </video>
    </div>

    <!-- Final fallback -->
    <div v-else class="video-fallback">
      <a :href="videoData.url" target="_blank" rel="noopener noreferrer" class="external-link">
        打开视频链接
      </a>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, PropType, onBeforeUnmount } from 'vue';
import { isEncryptedVideoRef, decodeEncryptedVideoRef } from '@/utils/encryptedVideoRef';
import { downloadAndDecryptVideo } from '@/utils/videoDecrypt';

export interface VideoData {
  type: 'video';
  url: string;
  provider: string;
  embedUrl?: string;
}

export default defineComponent({
  name: 'VideoPlayer',
  props: {
    videoData: {
      type: Object as PropType<VideoData>,
      required: true
    }
  },
  setup(props) {
    const playerLoaded = ref(false);
    const decrypting = ref(false);
    const decryptProgress = ref(0);
    const decryptStatus = ref('');
    const decryptError = ref<string | null>(null);
    const decryptedVideoUrl = ref<string | null>(null);

    const isEncrypted = computed(() => isEncryptedVideoRef(props.videoData.url));
    const displayUrl = computed(() => {
      if (isEncrypted.value) {
        return '加密视频';
      }
      return props.videoData.url;
    });

    async function loadPlayer() {
      playerLoaded.value = true;

      // If encrypted, decrypt on demand
      if (isEncrypted.value) {
        await decryptVideo();
      }
    }

    async function decryptVideo() {
      decrypting.value = true;
      decryptProgress.value = 0;
      decryptStatus.value = '准备解密...';
      decryptError.value = null;

      try {
        const metadata = decodeEncryptedVideoRef(props.videoData.url);
        if (!metadata) {
          throw new Error('无法解析加密视频元数据');
        }

        const videoBlob = await downloadAndDecryptVideo(
          metadata,
          (progress, status) => {
            decryptProgress.value = progress;
            decryptStatus.value = status;
          }
        );

        // Create object URL for decrypted video
        const objectUrl = URL.createObjectURL(videoBlob);
        decryptedVideoUrl.value = objectUrl;
        decrypting.value = false;
      } catch (error: any) {
        console.error('Video decryption failed:', error);
        decryptError.value = error?.message || '解密失败';
        decrypting.value = false;
      }
    }

    function retryDecryption() {
      decryptError.value = null;
      decryptVideo();
    }

    function truncateUrl(url: string, maxLength = 50): string {
      if (url.length <= maxLength) return url;
      return url.substring(0, maxLength) + '...';
    }

    // Cleanup object URL on component unmount
    onBeforeUnmount(() => {
      if (decryptedVideoUrl.value) {
        URL.revokeObjectURL(decryptedVideoUrl.value);
      }
    });

    return {
      playerLoaded,
      decrypting,
      decryptProgress,
      decryptStatus,
      decryptError,
      decryptedVideoUrl,
      isEncrypted,
      displayUrl,
      loadPlayer,
      retryDecryption,
      truncateUrl
    };
  }
});
</script>

<style scoped>
.video-player-container {
  width: 100%;
  margin: 12px 0;
  border-radius: 12px;
  overflow: hidden;
  background: #1f2937;
}

.video-poster {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 aspect ratio */
  background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
  cursor: pointer;
  transition: all 0.3s ease;
}

.video-poster:hover {
  background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
}

.video-poster:focus {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

.poster-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: white;
}

.play-button {
  font-size: 48px;
  color: white;
  background: rgba(59, 130, 246, 0.9);
  border-radius: 50%;
  width: 80px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  transition: all 0.3s ease;
  padding-left: 4px; /* Visual centering for play icon */
}

.video-poster:hover .play-button {
  background: rgba(59, 130, 246, 1);
  transform: scale(1.1);
}

.video-meta {
  text-align: center;
}

.provider-badge {
  background: rgba(0, 0, 0, 0.6);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 8px;
  display: inline-block;
}

.video-url-display {
  font-size: 12px;
  color: #d1d5db;
  word-break: break-all;
}

/* Decryption progress UI */
.decryption-progress {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 aspect ratio */
  background: linear-gradient(135deg, #1f2937 0%, #374151 100%);
}

.progress-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: white;
}

.progress-spinner {
  font-size: 48px;
  margin-bottom: 16px;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.progress-text {
  font-size: 16px;
  margin-bottom: 16px;
  color: #d1d5db;
}

.progress-bar-container {
  width: 80%;
  max-width: 300px;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-percent {
  font-size: 14px;
  color: #9ca3af;
}

/* Decryption error UI */
.decryption-error {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 aspect ratio */
  background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
}

.error-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: white;
}

.error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.error-message {
  font-size: 16px;
  margin-bottom: 16px;
  text-align: center;
  color: #fecaca;
}

.retry-button {
  padding: 8px 24px;
  background: rgba(255, 255, 255, 0.2);
  border: 2px solid white;
  border-radius: 8px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.retry-button:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.05);
}

.video-player {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 aspect ratio */
}

.video-iframe,
.video-element {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
}

.video-element {
  background: #000;
}

.video-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1f2937;
  padding: 20px;
}

.external-link {
  color: #3b82f6;
  text-decoration: none;
  font-size: 16px;
  padding: 12px 24px;
  border: 2px solid #3b82f6;
  border-radius: 8px;
  transition: all 0.2s;
}

.external-link:hover {
  background: #3b82f6;
  color: white;
}
</style>

