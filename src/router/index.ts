import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import Login from "@/views/Login.vue";
import Home from "@/views/Home.vue";
import PostEditor from "@/views/PostEditor.vue";
import Friends from "@/views/Friends.vue";
import Settings from "@/views/Settings.vue";
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
    component: Login,
    meta: { requiresAuth: false }
  },
  {
    path: "/",
    name: "Home",
    component: Home,
    meta: { requiresAuth: true }
  },
  {
    path: "/post",
    name: "PostEditor",
    component: PostEditor,
    meta: { requiresAuth: true }
  },
  {
    path: "/friends",
    name: "Friends",
    component: Friends,
    meta: { requiresAuth: true }
  },
  {
    path: "/settings",
    name: "Settings",
    component: Settings,
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
    // (some apps persist keys in localStorage under skHex/pkHex). If your app already
    // hydrates keys on startup, this is redundant but harmless.
    if (!keyStore.pkHex) {
      try {
        const sk = localStorage.getItem("skHex") || "";
        const pk = localStorage.getItem("pkHex") || "";
        if (sk && !keyStore.skHex) keyStore.skHex = sk;
        if (pk && !keyStore.pkHex) keyStore.pkHex = pk;
      } catch {
        // ignore storage errors
      }
    }

    const requiresAuth = !!(to.meta && (to.meta as any).requiresAuth);

    if (to.path === "/login") {
      // If already logged in, redirect away from login
      if (keyStore.pkHex) {
        return next({ path: "/" });
      }
      return next();
    }

    if (requiresAuth) {
      if (!keyStore.pkHex) {
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
