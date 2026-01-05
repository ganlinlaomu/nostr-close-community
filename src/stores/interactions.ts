import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { useInteractionsStore, Comment } from "./interactions";

export interface NotificationItem {
  id: string;
  type: "like" | "comment";
  from: string;
  messageId: string;
  commentId?: string;
  replyId?: string;
  created_at: number;
  read: boolean;

  // 自动填充内容
  postContent?: string;
  commentContent?: string;
}

const FIRST_LOGIN_DAYS = 3;
const DAY_SECONDS = 86400;

function notificationsKeyFor(pk?: string) { if (!pk) return null; return `nostr_notifications_${pk}`; }
function dismissedKeyFor(pk?: string) { if (!pk) return null; return `nostr_notifications_dismissed_${pk}`; }
function metaKeyFor(pk?: string) { if (!pk) return null; return `nostr_notifications_meta_${pk}`; }

interface NotificationMeta {
  lastSeenAt: number;
  seenEventIds: string[];
}

function loadMeta(pk: string): NotificationMeta | null {
  try { const raw = localStorage.getItem(metaKeyFor(pk)!); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function saveMeta(pk: string, meta: NotificationMeta) {
  try { localStorage.setItem(metaKeyFor(pk)!, JSON.stringify(meta)); } catch {}
}

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
      return this.meta?.lastSeenAt || now - FIRST_LOGIN_DAYS * DAY_SECONDS;
    },
  },

  actions: {
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      // Load notifications
      try {
        const raw = localStorage.getItem(notificationsKeyFor(targetPk)!);
        this.list = raw ? JSON.parse(raw) : [];
      } catch { this.list = []; }

      // Load dismissed
      try {
        const raw = localStorage.getItem(dismissedKeyFor(targetPk)!);
        this.dismissed = raw ? new Set(JSON.parse(raw)) : new Set();
      } catch { this.dismissed = new Set(); }

      // Load meta
      let meta = loadMeta(targetPk);
      if (!meta) {
        const now = Math.floor(Date.now() / 1000);
        meta = { lastSeenAt: now - FIRST_LOGIN_DAYS * DAY_SECONDS, seenEventIds: [] };
        saveMeta(targetPk, meta);
      }
      this.meta = meta;

      // ⭐ 填充帖文和评论内容
      const interactions = useInteractionsStore();
      this.list.forEach(n => {
        // 填充评论内容
        if (n.commentId) {
          const comment: Comment | undefined = interactions.getComments(n.messageId).find(c => c.id === n.commentId);
          n.commentContent = comment?.text || "[评论已删除]";
          if (comment?.parentCommentId) n.replyId = comment.parentCommentId;
        }
      });
    },

    save() {
      const pk = this.loadedFor || "";
      if (!pk) return;
      try {
        localStorage.setItem(notificationsKeyFor(pk)!, JSON.stringify(this.list));
        localStorage.setItem(dismissedKeyFor(pk)!, JSON.stringify([...this.dismissed]));
        if (this.meta) saveMeta(pk, this.meta);
      } catch {}
    },

    addNotification(n: NotificationItem) {
      if (!this.meta) return;
      if (this.meta.seenEventIds.includes(n.id)) return;
      if (n.created_at < this.since) return;
      if (this.dismissed.has(n.id)) return;
      if (this.list.find(x => x.id === n.id)) return;

      // ⭐ 填充评论内容
      if (n.commentId) {
        const interactions = useInteractionsStore();
        const comment: Comment | undefined = interactions.getComments(n.messageId).find(c => c.id === n.commentId);
        n.commentContent = comment?.text || "[评论已删除]";
        if (comment?.parentCommentId) n.replyId = comment.parentCommentId;
      }

      this.list.unshift(n);
      this.save();
    },

    markAsRead(id: string) { 
      const n = this.list.find(x => x.id === id); 
      if (!n || !this.meta) return;
      n.read = true;
      this.meta.lastSeenAt = Math.max(this.meta.lastSeenAt, n.created_at);
      if (!this.meta.seenEventIds.includes(id)) this.meta.seenEventIds.push(id);
      this.save();
    },

    markAllRead() {
      if (!this.meta) return;
      this.visibleList.forEach(n => {
        n.read = true;
        this.meta!.lastSeenAt = Math.max(this.meta!.lastSeenAt, n.created_at);
        if (!this.meta!.seenEventIds.includes(n.id)) this.meta!.seenEventIds.push(n.id);
      });
      this.save();
    },

    dismiss(id: string) { 
      this.dismissed.add(id); 
      if (this.meta && !this.meta.seenEventIds.includes(id)) this.meta.seenEventIds.push(id);
      this.save();
    },

    reset(removeFromStorage = false) {
      const pk = this.loadedFor || "";
      this.list = [];
      this.dismissed = new Set();
      this.meta = null;
      this.loadedFor = "";
      if (removeFromStorage && pk) {
        try {
          localStorage.removeItem(notificationsKeyFor(pk)!);
          localStorage.removeItem(dismissedKeyFor(pk)!);
          localStorage.removeItem(metaKeyFor(pk)!);
        } catch {}
      }
    },
  },
});
