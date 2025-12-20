<template>
  <div class="notifications-page">
    <header class="page-header">
      <h2>通知</h2>
      <button
        v-if="notifications.unreadCount > 0"
        class="mark-read"
        @click="notifications.markAllRead()"
      >
        全部已读
      </button>
    </header>

    <div v-if="notifications.list.length === 0" class="empty">
      暂无通知
    </div>

    <ul class="notification-list">
      <li
        v-for="n in notifications.list"
        :key="n.id"
        class="notification-item"
        :class="{ unread: !n.read }"
        @click="go(n)"
      >
        <div class="icon">
          {{ n.type === 'like' ? '❤️' : '💬' }}
        </div>

        <div class="content">
          <div class="text">
            <span class="from">{{ displayName(n.from) }}</span>
            {{ n.type === 'like' ? '点赞了你' : '评论了你' }}
          </div>
          <div class="time">
            {{ new Date(n.created_at * 1000).toLocaleString() }}
          </div>
        </div>

        <span v-if="!n.read" class="dot"></span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { useNotificationsStore } from "@/stores/notifications";
import { useRouter } from "vue-router";
import { useFriendsStore } from "@/stores/friends";


const notifications = useNotificationsStore();
const router = useRouter();
const friends = useFriendsStore();

function displayName(pk: string) {
  const f = friends.sortedList.find(f => f.pubkey === pk);
  return f?.name || pk.slice(0, 8) + "...";
}

function go(n: any) {
  notifications.markAsRead(n.id);

  // 跳转到 Home，并带参数
  router.push({
    path: "/",
    query: {
      mid: n.messageId,
      iid: n.commentId
    }
  });
}
</script>

<style scoped>
.notifications-page {
  padding: 12px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.mark-read {
  font-size: 12px;
  color: #64748b;
}

.notification-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.notification-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid #e5e7eb;
  cursor: pointer;
  position: relative;
}

.notification-item.unread {
  background: #f8fafc;
}

.icon {
  font-size: 18px;
}

.content {
  flex: 1;
}

.from {
  font-weight: 600;
}

.time {
  font-size: 12px;
  color: #64748b;
}

.dot {
  width: 8px;
  height: 8px;
  background: #ef4444;
  border-radius: 50%;
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
}

.empty {
  text-align: center;
  color: #94a3b8;
  margin-top: 40px;
}
</style>
