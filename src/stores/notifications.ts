import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { useInteractionsStore } from "./interactions";
import { getCurrentDatabase } from "@/db/dexie";

export interface NotificationItem {
  id: string;
  type: "like" | "comment";
  from: string;
  messageId: string;
  commentId?: string;
  replyId?: string;
  created_at: number;
  read: boolean;
  postContent?: string;
  commentContent?: string;
}

interface NotificationMeta {
  lastSeenAt: number;
  seenEventIds: string[];
}

const FIRST_LOGIN_DAYS = 3;
const DAY_SECONDS = 86400;

export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    list: [] as NotificationItem[],
    loadedFor: "" as string,
    dismissed: new Set<string>(),
    meta: null as NotificationMeta | null,
  }),

  getters: {
    visibleList: (s) => s.list.filter(n => !s.dismissed.has(n.id)),
    unreadCount(): number {
      return this.visibleList.filter(n => !n.read).length;
    },
    since(): number {
      const now = Math.floor(Date.now() / 1000);
      return this.meta?.lastSeenAt || (now - FIRST_LOGIN_DAYS * DAY_SECONDS);
    },
  },

  actions: {
    /* =========================
     * DB helpers（不再 fallback）
     * ========================= */
    getDB(pk: string) {
      return getDatabase(pk);
    },

    /* =========================
     * Load（账号隔离安全）
     * ========================= */
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      if (this.loadedFor === targetPk) return;

      // 🔐 切账号：先清内存
      this.list = [];
      this.dismissed = new Set();
      this.meta = null;
      this.loadedFor = targetPk;

      const db = this.getDB(targetPk);

      try {
        this.list = await db.notifications
          .orderBy("created_at")
          .reverse()
          .toArray() as NotificationItem[];
      } catch {
        this.list = [];
      }

      try {
        const dismissedData = await db.meta.get("notifications_dismissed");
        this.dismissed = new Set(dismissedData?.value || []);

        const metaData = await db.meta.get("notifications_meta");
        if (metaData) {
          this.meta = metaData.value;
        } else {
          const now = Math.floor(Date.now() / 1000);
          this.meta = {
            lastSeenAt: now - FIRST_LOGIN_DAYS * DAY_SECONDS,
            seenEventIds: [],
          };
          await db.meta.put({ key: "notifications_meta", value: this.meta });
        }
      } catch {
        this.dismissed = new Set();
      }

      this.refreshContent(targetPk);
    },

    refreshContent(pk: string) {
      if (pk !== this.loadedFor) return;

      const interactions = useInteractionsStore();
      if (interactions.loadedFor !== pk) return;

      this.list.forEach(n => {
        if (n.commentId && !n.commentContent) {
          const c = interactions
            .getComments(n.messageId)
            .find(x => x.id === n.commentId);
          if (c) {
            n.commentContent = c.text;
            if (c.parentCommentId) n.replyId = c.parentCommentId;
          }
        }
      });
    },

    async addNotification(n: NotificationItem) {
      if (!this.loadedFor) return;
      if (this.list.some(x => x.id === n.id)) return;
      if (this.dismissed.has(n.id)) return;

      const cutoff =
        Math.floor(Date.now() / 1000) - FIRST_LOGIN_DAYS * DAY_SECONDS;
      if (n.created_at < cutoff) return;

      this.list.unshift(n);
      this.list.sort((a, b) => b.created_at - a.created_at);
      if (this.list.length > 500) this.list.length = 500;

      await this.getDB(this.loadedFor).notifications.put(n as any);
    },

    async markAsRead(id: string) {
      if (!this.loadedFor) return;
      const n = this.list.find(x => x.id === id);
      if (!n) return;

      n.read = true;
      if (this.meta) {
        this.meta.lastSeenAt = Math.max(
          this.meta.lastSeenAt,
          n.created_at
        );
        await this.getDB(this.loadedFor).meta.put({
          key: "notifications_meta",
          value: this.meta,
        });
      }
      await this.getDB(this.loadedFor).notifications.put(n as any);
    },

    async markAllRead() {
      if (!this.loadedFor) return;
      const now = Math.floor(Date.now() / 1000);
      this.list.forEach(n => (n.read = true));

      if (this.meta) {
        this.meta.lastSeenAt = now;
        await this.getDB(this.loadedFor).meta.put({
          key: "notifications_meta",
          value: this.meta,
        });
      }

      await this.getDB(this.loadedFor)
        .notifications
        .toCollection()
        .modify({ read: true });
    },

    async dismiss(id: string) {
      if (!this.loadedFor) return;
      this.dismissed.add(id);
      await this.getDB(this.loadedFor).meta.put({
        key: "notifications_dismissed",
        value: [...this.dismissed],
      });
    },

    async reset(removeFromStorage = false) {
      const pk = this.loadedFor;
      this.list = [];
      this.dismissed = new Set();
      this.meta = null;
      this.loadedFor = "";

      if (removeFromStorage && pk) {
        const db = this.getDB(pk);
        await db.notifications.clear();
        await db.meta.delete("notifications_meta");
        await db.meta.delete("notifications_dismissed");
      }
    },
  },
});