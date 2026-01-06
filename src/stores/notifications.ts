import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
// 假设 interactions store 处理业务逻辑
import { useInteractionsStore } from "./interactions"; 
import { openDatabase, getCurrentDatabase } from "@/db/dexie"; // 修正引入

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
    /**
     * 获取当前数据库实例
     * 内部封装了对 openDatabase 的调用以确保实例存在
     */
    async getDB() {
      const ks = useKeyStore();
      const targetPk = ks.pkHex;
      if (!targetPk) throw new Error("No active public key");
      // openDatabase 会处理单例逻辑：pk 相同返回旧的，不同则切换
      return await openDatabase(targetPk);
    },

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      // 如果已经加载过该账号且库已打开，直接返回
      if (this.loadedFor === targetPk && this.list.length > 0) return;
      
      const db = await openDatabase(targetPk);
      this.loadedFor = targetPk;

      try {
        // 1. 从 notifications 表加载列表
        // 注意：需确保已经在 dexie.ts 中定义了 notifications table
        const rawList = await (db as any).notifications
          .orderBy("created_at")
          .reverse()
          .toArray();
        this.list = rawList;

        // 2. 从 meta 表加载元数据
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
      } catch (e) {
        console.error("Failed to load notifications", e);
        this.list = [];
      }
    },

    async saveNotification(n: NotificationItem) {
      const db = await this.getDB();
      await (db as any).notifications.put(n);
    },

    async saveMeta() {
      const db = await this.getDB();
      await db.meta.put({ key: "notifications_meta", value: this.meta });
    },

    async saveDismissed() {
      const db = await this.getDB();
      await db.meta.put({ key: "notifications_dismissed", value: [...this.dismissed] });
    },

    async addNotification(n: NotificationItem) {
      if (this.list.some(x => x.id === n.id)) return;
      if (this.dismissed.has(n.id)) return;
      
      const limit = Math.floor(Date.now() / 1000) - (FIRST_LOGIN_DAYS * DAY_SECONDS);
      if (n.created_at < limit) return;

      this.list.unshift(n);
      this.list.sort((a, b) => b.created_at - a.created_at);
      
      if (this.list.length > 500) this.list = this.list.slice(0, 500);

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
      
      const db = await this.getDB();
      await (db as any).notifications.toCollection().modify({ read: true });
    },

    async dismiss(id: string) { 
      this.dismissed.add(id); 
      await this.saveDismissed();
      // 可选：同时从数据库物理删除该通知
      const db = await this.getDB();
      await (db as any).notifications.delete(id);
    },

    async reset(removeFromStorage = false) {
      const db = await this.getDB();
      const pk = this.loadedFor;
      
      if (removeFromStorage && pk) {
        await (db as any).notifications.clear();
        await db.meta.delete("notifications_meta");
        await db.meta.delete("notifications_dismissed");
      }

      this.list = [];
      this.dismissed = new Set();
      this.meta = null;
      this.loadedFor = "";
    },
  },
});
