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

function notificationsKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_notifications_${pk}`;
}

export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    list: [] as NotificationItem[],
    loadedFor: "" as string,
  }),

  getters: {
    unreadCount: (state) => state.list.filter(n => !n.read).length,
  },

  actions: {
    /**
     * Load notifications from localStorage for the current user
     */
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) {
        this.list = [];
        this.loadedFor = "";
        return;
      }
      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

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
    },

    /**
     * Save notifications to localStorage
     */
    save() {
      const key = notificationsKeyFor(this.loadedFor || "");
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify(this.list));
      } catch {}
    },

    addNotification(n: NotificationItem) {
      // 去重（非常重要）
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
      this.list.forEach(n => (n.read = true));
      this.save();
    },

    /**
     * Reset notifications store - clear in-memory data and optionally remove from storage
     * @param removeFromStorage - If true, remove persisted notifications from localStorage
     */
    reset(removeFromStorage = false) {
      const pk = this.loadedFor || "";
      const key = notificationsKeyFor(pk);
      this.list = [];
      this.loadedFor = "";
      if (removeFromStorage) {
        try {
          if (key) localStorage.removeItem(key);
        } catch {}
      }
    },
  },
});
