import { defineStore } from "pinia";

export type NotificationItem = {
  id: string;
  type: "like" | "comment" | "reply";
  from: string;          // pubkey
  postId: string;        // 被点赞 / 评论的帖子 id
  commentId?: string;    // 如果是回复
  created_at: number;
  read: boolean;
};

export const useNotificationsStore = defineStore("notifications", {
  state: () => ({
    list: [] as NotificationItem[],
  }),

  getters: {
    unreadCount: (s) => s.list.filter(n => !n.read).length,
    unreadExists: (s) => s.list.some(n => !n.read),
  },

  actions: {
    add(n: NotificationItem) {
      if (this.list.find(x => x.id === n.id)) return;
      this.list.unshift(n);
    },

    markRead(id: string) {
      const n = this.list.find(x => x.id === id);
      if (n) n.read = true;
    },

    markAllRead() {
      this.list.forEach(n => (n.read = true));
    },
  },
});
