<template>
  <div class="video-player-container">
    <!-- Lazy loading: show poster/thumbnail until user clicks -->
    <div v-if="!playerLoaded" class="video-poster" @click="loadPlayer" @keyup.enter="loadPlayer" tabindex="0" role="button" :aria-label="`播放视频 - ${videoData.provider}`">
      <!-- Show actual thumbnail if available -->
      <img 
        v-if="thumbnailUrl" 
        :src="thumbnailUrl" 
        class="video-thumbnail" 
        :alt="`${videoData.provider} 视频缩略图`"
        @error="onThumbnailError"
      />
      <!-- Fallback to generic poster if no thumbnail -->
      <div v-else class="poster-content">
        <div class="play-button">▶</div>
        <div class="video-meta">
          <div class="provider-badge">{{ videoData.provider }}</div>
          <div class="video-url-display">{{ truncateUrl(videoData.url) }}</div>
        </div>
      </div>
      <!-- Play button overlay (always shown on top of thumbnail) -->
      <div class="play-button-overlay">
        <div class="play-button-large">▶</div>
      </div>
    </div>

    <!-- Player loaded: show iframe or video element -->
    <div v-else class="video-player">
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
import { defineComponent, ref, PropType, computed } from 'vue';
import { extractYouTubeVideoId, getYouTubeThumbnail, type VideoData } from '@/utils/videoUtils';

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
    const thumbnailError = ref(false);

    const thumbnailUrl = computed(() => {
      // If thumbnail failed to load, return null to show fallback
      if (thumbnailError.value) return null;
      
      // Use explicit thumbnail if provided
      if (props.videoData.thumbnail) {
        return props.videoData.thumbnail;
      }
      
      // Generate thumbnail for YouTube videos
      if (props.videoData.provider === 'YouTube' && props.videoData.embedUrl) {
        const videoId = extractYouTubeVideoId(props.videoData.embedUrl);
        if (videoId) {
          return getYouTubeThumbnail(videoId);
        }
      }
      
      // For Vimeo, we can't easily get thumbnails without API
      // For direct videos, use video element's poster (but we need the URL)
      // For now, return null for these cases
      return null;
    });

    function loadPlayer() {
      playerLoaded.value = true;
    }

    function onThumbnailError() {
      thumbnailError.value = true;
    }

    function truncateUrl(url: string, maxLength = 50): string {
      if (url.length <= maxLength) return url;
      return url.substring(0, maxLength) + '...';
    }

    return {
      playerLoaded,
      loadPlayer,
      truncateUrl,
      thumbnailUrl,
      onThumbnailError
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
  overflow: hidden;
}

.video-poster:hover {
  background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
}

.video-poster:focus {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

.video-thumbnail {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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

.play-button-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.play-button-large {
  font-size: 64px;
  color: white;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 50%;
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  padding-left: 6px; /* Visual centering for play icon */
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.video-poster:hover .play-button-large {
  background: rgba(59, 130, 246, 0.9);
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
