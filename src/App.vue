<template>
  <div id="app">
    <HeaderBar />
    <router-view />
    <ToastContainer />
    <PostEditorModal />
  </div>
</template>

<script lang="ts">
import { defineComponent, defineAsyncComponent } from "vue";
import HeaderBar from "@/components/HeaderBar.vue";

const ToastContainer = defineAsyncComponent(() => import("@/components/ToastContainer.vue"));
const PostEditorModal = defineAsyncComponent(() => import("@/components/PostEditorModal.vue"));

export default defineComponent({
  components: { HeaderBar, ToastContainer, PostEditorModal }
});
</script>
