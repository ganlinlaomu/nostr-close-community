<template>

  <!-- bottom nav moved into Headbar file for simplicity; only shown when logged in -->
  <nav v-if="isLoggedIn" class="bottom-nav">
    <router-link class="nav-item" to="/">
      <div class="icon">🏠</div>
      <div class="label">首页</div>
    </router-link>
    <router-link class="nav-item" to="/post">
      <div class="icon">✍️</div>
      <div class="label">发帖</div>
    </router-link>
    <router-link class="nav-item" to="/friends">
      <div class="icon">👥</div>
      <div class="label">好友</div>
    </router-link>
    <router-link class="nav-item" to="/settings">
      <div class="icon">⚙️</div>
      <div class="label">设置</div>
    </router-link>
  </nav>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useKeyStore } from "@/stores/keys";

export default defineComponent({
  name: "Headbar",
  setup() {
    const keys = useKeyStore();
    const isLoggedIn = computed(() => !!keys.pkHex);
    const shortPk = computed(() => (keys.pkHex ? keys.pkHex.slice(0, 8) + "..." : ""));
    return { isLoggedIn, shortPk };
  }
});
</script>

<style scoped>
.headbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #fff;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.brand { font-weight: 700; text-decoration: none; color: inherit; }
.login-link { text-decoration: none; color: #1976d2; }

.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-around;
  background: #ffffff;
  border-top: 1px solid rgba(0,0,0,0.06);
  /* Higher z-index to stay above modals and overlays for navigation access */
  z-index: 9999;
  /* Ensure the navigation creates its own stacking context and stays on top */
  isolation: isolate;
  /* Add backdrop filter for better visual separation */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  /* Ensure it's always visible and clickable */
  pointer-events: auto;
  /* Prevent any content from appearing above */
  will-change: transform;
  /* Add shadow for better visual separation */
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.05);
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-decoration: none;
  color: inherit;
  font-size: 12px;
}
.icon { font-size: 18px; line-height: 1; }
.label { margin-top: 2px; line-height: 1; }
</style>
