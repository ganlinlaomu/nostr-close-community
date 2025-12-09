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
    const images = computed(() => (props.showAll ? all.value.slice(0, props.max) : all.value.slice(0, 1)));
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
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.gallery-item {
  width: calc(33% - 8px);
  max-width: 200px;
  height: auto;
  border-radius: 6px;
  object-fit: cover;
}
@media (min-width: 720px) {
  .gallery-item { width: calc(25% - 8px); }
}
</style>
