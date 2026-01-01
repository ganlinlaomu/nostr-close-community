<template>
  <div class="post-image-preview" v-if="images.length > 0">
    <img
      v-if="!showAll"
      :src="images[0].url"
      :alt="altText"
      class="post-image-first"
      @error="onError(0)"
      loading="lazy"
    />
    <div v-else class="gallery" :class="galleryClass">
      <img
        v-for="(img, idx) in images"
        :key="idx"
        :src="img.url"
        :alt="altText"
        class="gallery-item"
        @error="onError(idx)"
        loading="lazy"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onBeforeUnmount, watch } from "vue";
import { extractImageUrls } from "@/utils/extractImageUrls";
import { decodeEncryptedImageRef, isEncryptedImageRef } from "@/utils/encryptedImageRef";
import { base64ToBytes } from "@/nostr/crypto";

interface ImageItem {
  url: string;
  isEncrypted: boolean;
}

export default defineComponent({
  name: "PostImagePreview",
  props: {
    content: { type: String, required: true },
    max: { type: Number, default: 9 },
    showAll: { type: Boolean, default: false },
    altText: { type: String, default: "image" }
  },
  setup(props) {
    const extractedUrls = computed(() => extractImageUrls(props.content || ""));
    const images = ref<ImageItem[]>([]);
    const objectUrls = new Set<string>();
    
    // Compute gallery class based on number of images for better browser compatibility
    const galleryClass = computed(() => {
      const count = images.value.length;
      if (count === 1) return 'gallery-single';
      if (count === 2) return 'gallery-two';
      if (count === 4) return 'gallery-four';
      return 'gallery-grid';
    });

    async function processImageUrl(url: string): Promise<ImageItem> {
      if (isEncryptedImageRef(url)) {
        // Decrypt encrypted image reference
        const metadata = decodeEncryptedImageRef(url);
        if (!metadata) {
          console.error("Failed to decode encrypted image reference:", url);
          return { url: "", isEncrypted: true };
        }

        try {
          // Fetch encrypted blob
          const response = await fetch(metadata.url);
          if (!response.ok) {
            console.error("Failed to fetch encrypted image:", response.status);
            return { url: "", isEncrypted: true };
          }
          
          const encryptedBytes = new Uint8Array(await response.arrayBuffer());
          
          // Import key and decrypt
          const keyBytes = base64ToBytes(metadata.key);
          const key = await crypto.subtle.importKey(
            "raw",
            keyBytes,
            "AES-GCM",
            false,
            ["decrypt"]
          );
          
          const ivBytes = base64ToBytes(metadata.iv);
          const decrypted = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: ivBytes },
            key,
            encryptedBytes
          );
          
          // Create object URL from decrypted bytes
          const blob = new Blob([decrypted], { type: metadata.mime });
          const objectUrl = URL.createObjectURL(blob);
          objectUrls.add(objectUrl);
          
          return { url: objectUrl, isEncrypted: true };
        } catch (error) {
          console.error("Failed to decrypt image:", error);
          return { url: "", isEncrypted: true };
        }
      } else {
        // Plain http(s) URL
        return { url, isEncrypted: false };
      }
    }

    async function loadImages() {
      const urls = props.showAll 
        ? extractedUrls.value.slice(0, props.max)
        : extractedUrls.value.slice(0, 1);
      
      // Clear previous object URLs
      objectUrls.forEach(url => {
        try { 
          URL.revokeObjectURL(url); 
        } catch (error) {
          console.error("Failed to revoke object URL:", error);
        }
      });
      objectUrls.clear();
      
      // Process all image URLs
      const processed = await Promise.all(urls.map(processImageUrl));
      images.value = processed.filter(img => img.url !== "");
    }

    // Watch for changes in content or display mode
    watch([() => props.content, () => props.showAll, () => props.max], loadImages, { immediate: true });

    const failed = ref<Record<number, boolean>>({});

    function onError(idx: number) {
      failed.value[idx] = true;
    }

    onBeforeUnmount(() => {
      // Clean up object URLs
      objectUrls.forEach(url => {
        try { 
          URL.revokeObjectURL(url); 
        } catch (error) {
          console.error("Failed to revoke object URL:", error);
        }
      });
      objectUrls.clear();
    });

    return { images, onError, failed, galleryClass };
  }
});
</script>

<style scoped>
.post-image-first {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  display: block;
  margin: 8px 0;
}
.gallery {
  display: grid;
  gap: 4px;
  margin: 8px 0;
}
/* Default 3-column grid for 3+ images */
.gallery-grid {
  grid-template-columns: repeat(3, 1fr);
}
/* Single image - full width */
.gallery-single {
  grid-template-columns: 1fr;
}
.gallery-single .gallery-item {
  aspect-ratio: auto;
  max-height: 400px;
}
/* Two images - 2 columns */
.gallery-two {
  grid-template-columns: repeat(2, 1fr);
}
/* Four images - 2x2 grid */
.gallery-four {
  grid-template-columns: repeat(2, 1fr);
}
.gallery-item {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 6px;
  object-fit: cover;
  background: #f1f5f9;
}
@media (min-width: 720px) {
  .gallery { gap: 6px; }
}
</style>
