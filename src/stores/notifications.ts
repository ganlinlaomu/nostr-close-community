import { defineStore } from "pinia";

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

export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    list: [] as NotificationItem[],
  }),

  getters: {
    unreadCount: (state) => state.list.filter(n => !n.read).length,
  },

  actions: {
    addNotification(n: NotificationItem) {
      // 去重（非常重要）
      if (this.list.find(x => x.id === n.id)) return;
      this.list.unshift(n);
    },

    markAsRead(id: string) {
      const n = this.list.find(x => x.id === id);
      if (n) n.read = true;
    },

    markAllRead() {
      this.list.forEach(n => (n.read = true));
    },
  },
});
