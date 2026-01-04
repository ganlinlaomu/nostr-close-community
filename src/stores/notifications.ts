import { defineStore } from "pinia";
import { useKeyStore } from "./keys";

export interface NotificationItem {
  id: string;
  type: "like" | "comment";
  from: string;
  messageId: string;
  commentId?: string;
  replyId?: string;
  created_at: number;
  read: boolean;
}

/* ================== storage key helpers ================== */

function notificationsKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_notifications_${pk}`;
}

// ⭐ 忽略列表 key（按用户隔离）
function dismissedKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_notifications_dismissed_${pk}`;
}

/* ================== store ================== */

export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    list: [] as NotificationItem[],
    loadedFor: "" as string,

    // ⭐ 新增：被忽略的通知 id
    dismissed: new Set<string>(),
  }),

  getters: {
    // ⭐ 只暴露“可见通知”
    visibleList: (state) =>
      state.list.filter(n => !state.dismissed.has(n.id)),

    // ⭐ unreadCount 基于 visibleList
    unreadCount(): number {
      return this.visibleList.filter(n => !n.read).length;
    },
  },

  actions: {
    /**
     * Load notifications & dismissed list from localStorage
     */
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;

      if (!targetPk) {
        this.list = [];
        this.dismissed = new Set();
        this.loadedFor = "";
        return;
      }

      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      /* ---------- load notifications ---------- */
      try {
        const key = notificationsKeyFor(targetPk);
        if (key) {
          const raw = localStorage.getItem(key);
          this.list = raw ? JSON.parse(raw) : [];
        } else {
          this.list = [];
        }
      } catch {
        this.list = [];
      }

      /* ---------- ⭐ load dismissed ---------- */
      try {
        const dkey = dismissedKeyFor(targetPk);
        if (dkey) {
          const raw = localStorage.getItem(dkey);
          this.dismissed = raw
            ? new Set<string>(JSON.parse(raw))
            : new Set();
        } else {
          this.dismissed = new Set();
        }
      } catch {
        this.dismissed = new Set();
      }
    },

    /**
     * Save notifications & dismissed list
     */
    save() {
      const pk = this.loadedFor || "";
      const key = notificationsKeyFor(pk);
      const dkey = dismissedKeyFor(pk);

      try {
        if (key) {
          localStorage.setItem(key, JSON.stringify(this.list));
        }
        // ⭐ 同步保存 dismissed
        if (dkey) {
          localStorage.setItem(
            dkey,
            JSON.stringify([...this.dismissed])
          );
        }
      } catch {}
    },

    /**
     * Add a notification (with dismissed filter)
     */
    addNotification(n: NotificationItem) {
      // ⭐ 如果被忽略，永远不再加入
      if (this.dismissed.has(n.id)) return;

      // 去重（原有逻辑）
      if (this.list.find(x => x.id === n.id)) return;

      this.list.unshift(n);
      this.save();
    },

    markAsRead(id: string) {
      const n = this.list.find(x => x.id === id);
      if (n) {
        n.read = true;
        this.save();
      }
    },

    markAllRead() {
      // ⭐ 只标记“可见”的
      this.visibleList.forEach(n => (n.read = true));
      this.save();
    },

    /**
     * ⭐ 忽略通知（Nostr 正确语义）
     */
    dismiss(id: string) {
      this.dismissed.add(id);
      this.save();
    },

    /**
     * Reset notifications store
     */
    reset(removeFromStorage = false) {
      const pk = this.loadedFor || "";
      const key = notificationsKeyFor(pk);
      const dkey = dismissedKeyFor(pk);

      this.list = [];
      this.dismissed = new Set();
      this.loadedFor = "";

      if (removeFromStorage) {
        try {
          if (key) localStorage.removeItem(key);
          if (dkey) localStorage.removeItem(dkey);
        } catch {}
      }
    },
  },
});
