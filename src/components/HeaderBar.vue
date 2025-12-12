<template>

  <!-- bottom nav moved into Headbar file for simplicity; only shown when logged in -->
  <nav v-if="isLoggedIn" class="bottom-nav">
    <router-link class="nav-item" to="/">
      <div class="icon">🏠</div>
    </router-link>
    <a class="nav-item" @click.prevent="handlePostClick">
      <div class="icon">✍️</div>
    </a>
    <router-link class="nav-item" to="/friends">
      <div class="icon">👥</div>
    </router-link>
    <router-link class="nav-item" to="/settings">
      <div class="icon">⚙️</div>
    </router-link>
  </nav>
</template>

<script lang="ts">
import { defineComponent, computed } from "vue";
import { useKeyStore } from "@/stores/keys";
import { useUIStore } from "@/stores/ui";

export default defineComponent({
  name: "Headbar",
  setup() {
    const keys = useKeyStore();
    const ui = useUIStore();
    const isLoggedIn = computed(() => !!keys.pkHex);
    const shortPk = computed(() => (keys.pkHex ? keys.pkHex.slice(0, 8) + "..." : ""));
    
    function handlePostClick() {
      ui.openPostEditor();
    }
    
    return { isLoggedIn, shortPk, handlePostClick };
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
  border-top: 1px solid rgba(0,0,0,0.08);
  z-index: var(--z-bottom-nav, 9999);
  isolation: isolate;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  pointer-events: auto;
  box-shadow: 0 -1px 8px rgba(0, 0, 0, 0.06);
  padding-bottom: env(safe-area-inset-bottom);
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  color: #64748b;
  padding: 10px 20px;
  cursor: pointer;
  transition: all 0.2s;
  border-radius: 12px;
  position: relative;
}
.nav-item:hover {
  background: rgba(59, 130, 246, 0.08);
  color: #3b82f6;
}
.nav-item.router-link-active {
  color: #1976d2;
}
.nav-item.router-link-active::after {
  content: '';
  position: absolute;
  bottom: 6px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  background: #1976d2;
  border-radius: 50%;
}
.icon { 
  font-size: 26px; 
  line-height: 1;
}
</style>
