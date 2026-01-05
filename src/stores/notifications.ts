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

/* ================== constants ================== */

const FIRST_LOGIN_DAYS = 3;
const DAY_SECONDS = 86400;

/* ================== storage key helpers ================== */

function notificationsKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_notifications_${pk}`;
}

function dismissedKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_notifications_dismissed_${pk}`;
}

// ⭐ 新增：meta key
function metaKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_notifications_meta_${pk}`;
}

/* ================== meta ================== */

interface NotificationMeta {
  lastSeenAt: number;     // 秒
  seenEventIds: string[];
}

function loadMeta(pk: string): NotificationMeta | null {
  try {
    const raw = localStorage.getItem(metaKeyFor(pk)!);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveMeta(pk: string, meta: NotificationMeta) {
  try {
    localStorage.setItem(metaKeyFor(pk)!, JSON.stringify(meta));
  } catch {}
}

/* ================== store ================== */

export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    list: [] as NotificationItem[],
    loadedFor: "" as string,

    dismissed: new Set<string>(),

    // ⭐ 新增：meta
    meta: null as NotificationMeta | null,
  }),

  getters: {
    visibleList: (state) =>
      state.list.filter(n => !state.dismissed.has(n.id)),

    unreadCount(): number {
      return this.visibleList.filter(n => !n.read).length;
    },

    // ⭐ 给 relay 使用的 since（秒）
    since(): number {
      const now = Math.floor(Date.now() / 1000);
      if (!this.meta) {
        return now - FIRST_LOGIN_DAYS * DAY_SECONDS;
      }
      return this.meta.lastSeenAt || now - FIRST_LOGIN_DAYS * DAY_SECONDS;
    },
  },

  actions: {
    /* ================== load ================== */

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;

      if (!targetPk) {
        this.list = [];
        this.dismissed = new Set();
        this.meta = null;
        this.loadedFor = "";
        return;
      }

      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      /* ---------- load notifications ---------- */
      try {
        const key = notificationsKeyFor(targetPk);
        const raw = key ? localStorage.getItem(key) : null;
        this.list = raw ? JSON.parse(raw) : [];
      } catch {
        this.list = [];
      }

      /* ---------- load dismissed ---------- */
      try {
        const dkey = dismissedKeyFor(targetPk);
        const raw = dkey ? localStorage.getItem(dkey) : null;
        this.dismissed = raw ? new Set<string>(JSON.parse(raw)) : new Set();
      } catch {
        this.dismissed = new Set();
      }

      /* ---------- ⭐ load / init meta ---------- */
      let meta = loadMeta(targetPk);
      if (!meta) {
        const now = Math.floor(Date.now() / 1000);
        meta = {
          lastSeenAt: now - FIRST_LOGIN_DAYS * DAY_SECONDS,
          seenEventIds: [],
        };
        saveMeta(targetPk, meta);
      }
      this.meta = meta;
    },

    /* ================== save ================== */

    save() {
      const pk = this.loadedFor || "";
      if (!pk) return;

      try {
        localStorage.setItem(
          notificationsKeyFor(pk)!,
          JSON.stringify(this.list)
        );

        localStorage.setItem(
          dismissedKeyFor(pk)!,
          JSON.stringify([...this.dismissed])
        );

        if (this.meta) {
          saveMeta(pk, this.meta);
        }
      } catch {}
    },

    /* ================== add ================== */

    addNotification(n: NotificationItem) {
      if (!this.meta) return;

      // ⭐ seen 过 → 永不再显示
      if (this.meta.seenEventIds.includes(n.id)) return;

      // ⭐ 首次登入时间窗过滤
      if (n.created_at < this.since) return;

      // ⭐ 忽略过 → 永不再显示
      if (this.dismissed.has(n.id)) return;

      // 去重
      if (this.list.find(x => x.id === n.id)) return;

      this.list.unshift(n);
      this.save();
    },

    /* ================== read / dismiss ================== */

    markAsRead(id: string) {
      const n = this.list.find(x => x.id === id);
      if (!n || !this.meta) return;

      n.read = true;

      // ⭐ 更新 meta
      this.meta.lastSeenAt = Math.max(
        this.meta.lastSeenAt,
        n.created_at
      );

      if (!this.meta.seenEventIds.includes(id)) {
        this.meta.seenEventIds.push(id);
      }

      this.save();
    },

    markAllRead() {
      if (!this.meta) return;

      this.visibleList.forEach(n => {
        n.read = true;
        this.meta!.lastSeenAt = Math.max(
          this.meta!.lastSeenAt,
          n.created_at
        );
        if (!this.meta!.seenEventIds.includes(n.id)) {
          this.meta!.seenEventIds.push(n.id);
        }
      });

      this.save();
    },

    dismiss(id: string) {
      this.dismissed.add(id);

      if (this.meta && !this.meta.seenEventIds.includes(id)) {
        this.meta.seenEventIds.push(id);
      }

      this.save();
    },

    /* ================== reset ================== */

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
