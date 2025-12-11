import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import { useKeyStore } from "@/stores/keys";

/**
 * Central router with route-level auth guard.
 *
 * Behavior:
 * - Routes that require authentication include meta: { requiresAuth: true }.
 * - Global beforeEach checks the key store (pkHex) and redirects to /login if needed.
 * - /login redirects to home if already logged in.
 *
 * Note:
 * - Ensure in src/main.ts you call app.use(createPinia()) before app.use(router)
 *   so the Pinia stores are available inside the navigation guard.
 */

const routes: Array<RouteRecordRaw> = [
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/Login.vue"),
    meta: { requiresAuth: false }
  },
  {
    path: "/",
    name: "Home",
    component: () => import("@/views/Home.vue"),
    meta: { requiresAuth: true }
  },
  {
    path: "/post",
    name: "PostEditor",
    component: () => import("@/views/PostEditor.vue"),
    meta: { requiresAuth: true }
  },
  {
    path: "/friends",
    name: "Friends",
    component: () => import("@/views/Friends.vue"),
    meta: { requiresAuth: true }
  },
  {
    path: "/settings",
    name: "Settings",
    component: () => import("@/views/Settings.vue"),
    meta: { requiresAuth: true }
  },
  // fallback
  {
    path: "/:pathMatch(.*)*",
    redirect: "/"
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

// navigation guard
router.beforeEach(async (to, from, next) => {
  try {
    const keyStore = useKeyStore();
    // If store hasn't loaded keys from localStorage yet, try to hydrate quickly
    if (!keyStore.pkHex) {
      try {
        const sk = localStorage.getItem("skHex") || "";
        const pk = localStorage.getItem("pkHex") || "";
        const loginMethod = localStorage.getItem("loginMethod") || "";
        const bunkerInput = localStorage.getItem("bunkerInput") || "";
        const loginTimestamp = localStorage.getItem("loginTimestamp") || "0";
        
        if (sk && !keyStore.skHex) keyStore.skHex = sk;
        if (pk && !keyStore.pkHex) keyStore.pkHex = pk;
        if (loginMethod && !keyStore.loginMethod) {
          keyStore.loginMethod = loginMethod as "sk" | "nip07" | "nip46" | "";
        }
        if (loginTimestamp && !keyStore.loginTimestamp) {
          keyStore.loginTimestamp = parseInt(loginTimestamp, 10) || 0;
        }
        
        // Restore bunker signer if needed (blocking for proper initialization)
        if (loginMethod === "nip46" && bunkerInput && !keyStore.bunkerSigner) {
          // Try to restore bunker connection and wait for it
          // This is necessary to ensure bunker is ready for NIP-04 operations
          try {
            await keyStore.loginWithBunker(bunkerInput);
          } catch (e) {
            // If bunker restore fails, don't log out immediately
            // The user may be temporarily offline and can reconnect later
            console.warn("Failed to restore bunker connection, marking as disconnected:", e);
            keyStore.bunkerConnectionStatus = "error";
            keyStore.bunkerLastError = (e as any)?.message || "连接失败";
            // Keep the login state but mark bunker as disconnected
            // User can try operations which will show clear error messages
          }
        }
      } catch {
        // ignore storage errors
      }
    }

    const requiresAuth = !!(to.meta && (to.meta as any).requiresAuth);

    if (to.path === "/login") {
      // If already logged in, redirect away from login
      if (keyStore.isLoggedIn) {
        return next({ path: "/" });
      }
      return next();
    }

    if (requiresAuth) {
      if (!keyStore.isLoggedIn) {
        // not logged in -> go to login
        return next({ path: "/login", query: { redirect: to.fullPath } });
      }
    }
    return next();
  } catch (e) {
    // On unexpected errors, be conservative and redirect to login
    return next({ path: "/login" });
  }
});

export default router;
