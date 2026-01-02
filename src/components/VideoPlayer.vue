<template>
  <div class="video-player-container">
    <!-- Direct video rendering without thumbnail -->
    <div class="video-player">
      <!-- YouTube embed -->
      <iframe
        v-if="videoData.provider === 'YouTube' && videoData.embedUrl"
        :src="videoData.embedUrl"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        class="video-iframe"
      ></iframe>

      <!-- Vimeo embed -->
      <iframe
        v-else-if="videoData.provider === 'Vimeo' && videoData.embedUrl"
        :src="videoData.embedUrl"
        frameborder="0"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        class="video-iframe"
      ></iframe>

      <!-- Direct video or hosted video -->
      <video
        v-else-if="videoData.embedUrl"
        :src="videoData.embedUrl"
        controls
        class="video-element"
        preload="metadata"
      >
        您的浏览器不支持视频播放。
      </video>

      <!-- Fallback for external links -->
      <div v-else class="video-fallback">
        <a :href="videoData.url" target="_blank" rel="noopener noreferrer" class="external-link">
          打开外部视频链接
        </a>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';
import type { VideoData } from '@/utils/videoUtils';

export default defineComponent({
  name: 'VideoPlayer',
  props: {
    videoData: {
      type: Object as PropType<VideoData>,
      required: true
    }
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
