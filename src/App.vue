<template>
  <div id="app">
    <HeaderBar />
    <router-view />
    <ToastContainer />
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import HeaderBar from "@/components/HeaderBar.vue";
import ToastContainer from "@/components/ToastContainer.vue";

export default defineComponent({
  components: { HeaderBar, ToastContainer }
});
</script>
