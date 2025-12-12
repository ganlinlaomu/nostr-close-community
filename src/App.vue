<template>
  <div class="app-root">
    <HeaderBar />
    <router-view />
    <ToastContainer />
    <PostEditorModal />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import HeaderBar from "@/components/HeaderBar.vue";
import ToastContainer from "@/components/ToastContainer.vue";
import PostEditorModal from "@/components/PostEditorModal.vue";

export default defineComponent({
  components: { HeaderBar, ToastContainer, PostEditorModal }
});
</script>
