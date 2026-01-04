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

    <div class="notification-groups">
      <!-- 今天 -->
      <template v-if="groups.today.length">
        <div class="group-title">今天</div>
        <TransitionGroup name="notify" tag="ul" class="notification-list">
          <li
            v-for="n in groups.today"
            :key="n.id"
            class="swipe-wrapper"
            @touchstart="onTouchStart($event, n.id)"
            @touchmove="onTouchMove($event, n.id)"
            @touchend="onTouchEnd(n.id)"
          >
            <!-- 操作按钮 -->
            <div class="swipe-actions">
              <button class="action read" @click.stop="markRead(n)">已读</button>
              <button class="action delete" @click.stop="remove(n)">删除</button>
            </div>

            <!-- 主内容 -->
            <div
              class="notification-item"
              :class="{ unread: !n.read }"
              :style="swipeStyle(n.id)"
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
                  {{ formatRelativeTime(n.created_at) }}
                </div>
              </div>

              <span v-if="!n.read" class="dot"></span>
            </div>
          </li>
        </TransitionGroup>
      </template>

      <!-- 昨天 -->
      <template v-if="groups.yesterday.length">
        <div class="group-title">昨天</div>
        <ul class="notification-list">
          <li
            v-for="n in groups.yesterday"
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
                {{ formatRelativeTime(n.created_at) }}
              </div>
            </div>
            <span v-if="!n.read" class="dot"></span>
          </li>
        </ul>
      </template>

      <!-- 更早 -->
      <template v-if="groups.earlier.length">
        <div class="group-title">更早</div>
        <ul class="notification-list">
          <li
            v-for="n in groups.earlier"
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
                {{ formatRelativeTime(n.created_at) }}
              </div>
            </div>
            <span v-if="!n.read" class="dot"></span>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
export default defineComponent({ name: "Notifications" });
</script>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { useNotificationsStore } from "@/stores/notifications";
import { useFriendsStore } from "@/stores/friends";
import { useRouter } from "vue-router";

const notifications = useNotificationsStore();
const friends = useFriendsStore();
const router = useRouter();

/* ---------- 时间分组 ---------- */
function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const groups = computed(() => {
  const todayStart = startOfDay(Date.now());
  const yesterdayStart = todayStart - 86400000;

  const res = { today: [], yesterday: [], earlier: [] } as any;

  [...notifications.list]
    .sort((a, b) => b.created_at - a.created_at)
    .forEach(n => {
      const t = n.created_at * 1000;
      if (t >= todayStart) res.today.push(n);
      else if (t >= yesterdayStart) res.yesterday.push(n);
      else res.earlier.push(n);
    });

  return res;
});

/* ---------- iOS 相对时间 ---------- */
function formatRelativeTime(ts: number) {
  const now = Date.now();
  const t = ts * 1000;
  const diff = Math.floor((now - t) / 1000);

  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;

  const d = new Date(t);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
}

/* ---------- 左滑逻辑 ---------- */
const swipe = reactive<Record<string, number>>({});
const startX = reactive<Record<string, number>>({});

function onTouchStart(e: TouchEvent, id: string) {
  startX[id] = e.touches[0].clientX;
}

function onTouchMove(e: TouchEvent, id: string) {
  const dx = e.touches[0].clientX - startX[id];
  swipe[id] = Math.min(0, Math.max(dx, -120));
}

function onTouchEnd(id: string) {
  swipe[id] = swipe[id] < -60 ? -120 : 0;
}

function swipeStyle(id: string) {
  return {
    transform: `translateX(${swipe[id] || 0}px)`
  };
}

/* ---------- 操作 ---------- */
function markRead(n: any) {
  notifications.markAsRead(n.id);
  swipe[n.id] = 0;
}

function remove(n: any) {
  notifications.remove(n.id);
}

function displayName(pk: string) {
  const f = friends.sortedList.find(f => f.pubkey === pk);
  return f?.name || pk.slice(0, 8) + "...";
}

function go(n: any) {
  notifications.markAsRead(n.id);
  router.push({ path: "/", query: { mid: n.messageId, iid: n.commentId } });
}
</script>

<style scoped>
.notifications-page {
  padding: 12px;
  padding-bottom: calc(20px + var(--bottom-nav-height) + env(safe-area-inset-bottom));
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.group-title {
  margin: 16px 4px 6px;
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
}

.notification-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

/* ---------- 左滑结构 ---------- */
.swipe-wrapper {
  position: relative;
  overflow: hidden;
}

.swipe-actions {
  position: absolute;
  right: 0;
  top: 0;
  height: 100%;
  display: flex;
}

.action {
  width: 60px;
  color: #fff;
  font-size: 12px;
}

.action.read {
  background: #64748b;
}

.action.delete {
  background: #ef4444;
}

/* ---------- 通知项 ---------- */
.notification-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
  transition: transform 0.25s ease;
}

.notification-item.unread {
  background: linear-gradient(90deg, #f8fafc, #ffffff);
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

/* ---------- 入场动画 ---------- */
.notify-enter-from {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
.notify-enter-active {
  transition: all 0.35s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.empty {
  text-align: center;
  color: #94a3b8;
  margin-top: 40px;
}
</style>
