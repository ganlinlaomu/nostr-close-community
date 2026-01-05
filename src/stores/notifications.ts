import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { useInteractionsStore } from "./interactions";
import { getDatabase } from "@/db/dexie"; // 1. 引入工厂

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
    visibleList: (state) => state.list.filter(n => !state.dismissed.has(n.id)),
    unreadCount(): number { return this.visibleList.filter(n => !n.read).length; },
    since(): number { 
      const now = Math.floor(Date.now() / 1000);
      return this.meta?.lastSeenAt || (now - FIRST_LOGIN_DAYS * DAY_SECONDS);
    },
  },

  actions: {
    // 2. 获取当前账号对应的物理库
    getDB() {
      const ks = useKeyStore();
      return getDatabase(this.loadedFor || ks.pkHex);
    },

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      const db = this.getDB();

      // 1. 从物理库加载列表（按时间倒序）
      try {
        this.list = await db.notifications.orderBy("created_at").reverse().toArray() as any;
      } catch { this.list = []; }

      // 2. 从物理库 meta 表加载元数据和屏蔽列表
      try {
        const dismissedData = await db.meta.get("notifications_dismissed");
        this.dismissed = new Set(dismissedData?.value || []);

        const metaData = await db.meta.get("notifications_meta");
        if (metaData) {
          this.meta = metaData.value;
        } else {
          const now = Math.floor(Date.now() / 1000);
          this.meta = { lastSeenAt: now - FIRST_LOGIN_DAYS * DAY_SECONDS, seenEventIds: [] };
          await this.saveMeta();
        }
      } catch {
        this.dismissed = new Set();
      }

      this.refreshContent();
    },

    refreshContent() {
      const interactions = useInteractionsStore();
      this.list.forEach(n => {
        if (n.commentId && !n.commentContent) {
          const comment = interactions.getComments(n.messageId).find(c => c.id === n.commentId);
          if (comment) {
            n.commentContent = comment.text;
            if (comment.parentCommentId) n.replyId = comment.parentCommentId;
          }
        }
      });
    },

    // 3. 将 save 分拆，直接写入 Dexie 效率更高
    async saveNotification(n: NotificationItem) {
      const db = this.getDB();
      await db.notifications.put(n as any);
    },

    async saveMeta() {
      const db = this.getDB();
      await db.meta.put({ key: "notifications_meta", value: this.meta });
    },

    async saveDismissed() {
      const db = this.getDB();
      await db.meta.put({ key: "notifications_dismissed", value: [...this.dismissed] });
    },

    async addNotification(n: NotificationItem) {
      if (this.list.some(x => x.id === n.id)) return;
      if (this.dismissed.has(n.id)) return;
      
      const threeDaysAgo = Math.floor(Date.now() / 1000) - (FIRST_LOGIN_DAYS * DAY_SECONDS);
      if (n.created_at < threeDaysAgo) return;

      // 填充内容
      if (n.commentId) {
        const interactions = useInteractionsStore();
        const comment = interactions.getComments(n.messageId).find(c => c.id === n.commentId);
        if (comment) {
          n.commentContent = comment.text;
          if (comment.parentCommentId) n.replyId = comment.parentCommentId;
        }
      }

      this.list.unshift(n);
      this.list.sort((a, b) => b.created_at - a.created_at);
      
      if (this.list.length > 500) this.list = this.list.slice(0, 500); // 数据库容量大，可以多留点

      // 物理保存
      await this.saveNotification(n);
    },

    async markAsRead(id: string) { 
      const n = this.list.find(x => x.id === id); 
      if (!n) return;
      n.read = true;
      if (this.meta) {
        this.meta.lastSeenAt = Math.max(this.meta.lastSeenAt, n.created_at);
        await this.saveMeta();
      }
      await this.saveNotification(n);
    },

    async markAllRead() {
      const now = Math.floor(Date.now() / 1000);
      this.list.forEach(n => { n.read = true; });
      if (this.meta) {
        this.meta.lastSeenAt = now;
        await this.saveMeta();
      }
      // 批量更新数据库里的已读状态
      const db = this.getDB();
      await db.notifications.toCollection().modify({ read: true });
    },

    async dismiss(id: string) { 
      this.dismissed.add(id); 
      await this.saveDismissed();
    },

    reset(removeFromStorage = false) {
      const db = this.getDB();
      const pk = this.loadedFor;
      this.list = [];
      this.dismissed = new Set();
      this.meta = null;
      this.loadedFor = "";

      if (removeFromStorage && pk) {
        db.notifications.clear();
        db.meta.delete("notifications_meta");
        db.meta.delete("notifications_dismissed");
      }
    },
  },
});
