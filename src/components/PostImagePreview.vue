<template>
  <div class="post-image-preview" v-if="images.length > 0">
    <img
      v-if="!showAll"
      :src="images[0]"
      :alt="altText"
      class="post-image-first"
      @error="onError(0)"
      loading="lazy"
    />
    <div v-else class="gallery">
      <img
        v-for="(u, idx) in images"
        :key="idx"
        :src="u"
        :alt="altText"
        class="gallery-item"
        @error="onError(idx)"
        loading="lazy"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from "vue";
import { extractImageUrls } from "@/utils/extractImageUrls";

export default defineComponent({
  name: "PostImagePreview",
  props: {
    content: { type: String, required: true },
    max: { type: Number, default: 3 },
    showAll: { type: Boolean, default: false },
    altText: { type: String, default: "image" }
  },
  setup(props) {
    const all = computed(() => extractImageUrls(props.content || ""));
    const images = computed(() => {
      if (props.showAll) {
        // Show up to max images (default 9 for grid)
        return all.value.slice(0, props.max);
      } else {
        // Show only first image
        return all.value.slice(0, 1);
      }
    });
    const failed = ref<Record<number, boolean>>({});

    function onError(idx: number) {
      failed.value[idx] = true;
      // We keep the broken src so Vue can react; parent can choose to remove by filtering if desired.
    }

    return { images, onError, failed };
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
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin: 8px 0;
}
.gallery-item {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 6px;
  object-fit: cover;
  background: #f1f5f9;
}
/* Single image - full width */
.gallery:has(.gallery-item:only-child) {
  grid-template-columns: 1fr;
}
.gallery:has(.gallery-item:only-child) .gallery-item {
  aspect-ratio: auto;
  max-height: 400px;
}
/* Two images - 2 columns */
.gallery:has(.gallery-item:nth-child(2):last-child) {
  grid-template-columns: repeat(2, 1fr);
}
/* Four images - 2x2 grid */
.gallery:has(.gallery-item:nth-child(4):last-child) {
  grid-template-columns: repeat(2, 1fr);
}
@media (min-width: 720px) {
  .gallery { gap: 6px; }
}
</style>
