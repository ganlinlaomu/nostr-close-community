<template>

  <!-- bottom nav moved into Headbar file for simplicity; only shown when logged in -->
  <nav v-if="isLoggedIn" class="bottom-nav">
    <router-link class="nav-item" to="/">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
      </svg>
      <span class="nav-label">首页</span>
    </router-link>
    <a class="nav-item" @click.prevent="handlePostClick">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
      <span class="nav-label">发帖</span>
    </a>
    <router-link class="nav-item" to="/friends">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
      <span class="nav-label">好友</span>
    </a>
    <router-link class="nav-item" to="/settings">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 1v6m0 6v6m6-12h-6m6 6h-6m-6 0H1m5 0a6 6 0 0 0 6 6m0-12a6 6 0 0 1 6 6"></path>
        <path d="M12 1v6M12 17v6M1 12h6M17 12h6"></path>
        <path d="M19.07 4.93l-4.24 4.24M9.17 14.83l-4.24 4.24M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24"></path>
      </svg>
      <span class="nav-label">设置</span>
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
  height: 80px;
  display: flex;
  align-items: flex-start;
  justify-content: space-around;
  background: #ffffff;
  border-top: 1px solid rgba(0,0,0,0.08);
  z-index: var(--z-bottom-nav, 9999);
  isolation: isolate;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  pointer-events: auto;
  box-shadow: 0 -1px 8px rgba(0, 0, 0, 0.06);
  padding-top: 12px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  text-decoration: none;
  color: #64748b;
  padding: 8px 16px;
  cursor: pointer;
  transition: all 0.25s ease;
  border-radius: 12px;
  position: relative;
  min-width: 64px;
}
.nav-item:hover {
  background: rgba(59, 130, 246, 0.08);
  color: #3b82f6;
  transform: translateY(-2px);
}
.nav-item.router-link-active {
  color: #1976d2;
}
.nav-item.router-link-active .icon {
  stroke-width: 2.5;
}
.icon { 
  width: 24px;
  height: 24px;
  stroke: currentColor;
  transition: all 0.25s ease;
}
.nav-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
</style>
