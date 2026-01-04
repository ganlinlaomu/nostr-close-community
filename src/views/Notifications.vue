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

    <!-- ⭐ 空态：基于 visibleList -->
    <div v-if="notifications.visibleList.length === 0" class="empty">
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
              <button class="action read" @click.stop="markRead(n)">
                已读
              </button>
              <!-- ⭐ 删除 → 忽略 -->
              <button class="action delete" @click.stop="dismiss(n)">
                忽略
              </button>
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

<script setup lang="ts">
import { computed, reactive } from "vue";
import { useNotificationsStore } from "@/stores/notifications";
import { useFriendsStore } from "@/stores/friends";
import { useRouter } from "vue-router";

const notifications = useNotificationsStore();
const friends = useFriendsStore();
const router = useRouter();

/* ---------- 时间分组（⭐ 基于 visibleList） ---------- */
function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const groups = computed(() => {
  const todayStart = startOfDay(Date.now());
  const yesterdayStart = todayStart - 86400000;

  const res = { today: [], yesterday: [], earlier: [] } as any;

  [...notifications.visibleList]
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
  const diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;

  const d = new Date(ts * 1000);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString().slice(0, 5);
}

/* ---------- 左滑逻辑（不变） ---------- */
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
  return { transform: `translateX(${swipe[id] || 0}px)` };
}

/* ---------- 操作 ---------- */
function markRead(n: any) {
  notifications.markAsRead(n.id);
  swipe[n.id] = 0;
}

function dismiss(n: any) {
  notifications.dismiss(n.id);
  swipe[n.id] = 0;
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
