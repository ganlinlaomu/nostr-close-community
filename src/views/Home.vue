<template>
  <div v-if="loadingStore" class="loading-screen">
    <div class="loader">正在同步加密动态...</div>
  </div>

  <div v-else class="home-container" ref="container">
    <div
      class="pull-indicator"
      :style="{ height: pullDistance + 'px' }"
    >
      <span v-if="!refreshing">↓ 下拉刷新</span>
      <span v-else>⟳ 刷新中...</span>
    </div>
    
    <div 
      v-if="pendingMessages.length > 0" 
      class="new-messages-notification" 
      @click="showPendingMessages"
    >
      <span class="notification-icon">↓</span>
      <span class="notification-text">{{ pendingMessages.length }} 条新消息</span>
    </div>

    <div class="card">
      <h4 style="margin: 0 0 12px 0;">好友动态</h4>
      <div v-if="displayedMessages.length === 0" class="small">还没有消息</div>
      <div class="list">
        <div v-for="m in displayedMessages" :key="m.id" :id="`msg-${m.id}`" class="card post-card">
          <div class="small">
            <strong>{{ displayName(m.pubkey) }}</strong>
            <span class="muted"> · {{ toLocalTime(m.created_at) }}</span>
          </div>

          <div v-if="textWithoutVideos(m.content)" class="message-text">{{ textWithoutVideos(m.content) }}</div>
          
          <PostImagePreview v-if="m.content" :content="m.content" :showAll="true" :max="9" class="post-images" />
          <VideoPlayer v-if="extractVideoData(m.content)" :videoData="extractVideoData(m.content)" style="margin-top:8px;" />
          
          <div class="message-actions">
            <button class="action-btn" @click="toggleLike(m)" :class="{ 'liked': isLiked(m.id) }">
              <span class="action-icon">{{ isLiked(m.id) ? '❤️' : '🤍' }}</span>
              <span class="action-text">{{ getLikeCount(m.id) }}</span>
            </button>
            <button class="action-btn" @click="toggleComments(m.id)">
              <span class="action-icon">💬</span>
              <span class="action-text">{{ getCommentCount(m.id) }}</span>
            </button>
            <div v-if="m._localMeta?.groupCount" class="send-meta">
              <button class="action-btn send-btn" @click="toggleSendMeta(m.id)">
                <span class="action-icon">👀</span>
                <span class="action-text">{{ m._localMeta.groupCount }}</span>
              </button>
            </div>
          </div>

          <div class="message-expanded">
            <div v-if="showingSendMeta.has(m.id)" class="send-meta-panel">
              <div class="send-meta-title">对谁可见:</div>
              <div v-for="g in m._localMeta.groups" :key="g.name" class="send-meta-row">
                <span class="group-name">{{ g.name }}</span>
                <span class="group-count">{{ g.count }} 人</span>
              </div>
            </div>

            <div v-if="showingComments.has(m.id)" class="comments-section">
              <div class="comments-list">
                <div v-for="comment in getComments(m.id)" :key="comment.id" class="comment-thread">
                  <div class="comment-item" :id="`comment-${comment.id}`">
                    <div class="comment-header small">
                      <strong>{{ displayName(comment.author) }}</strong>
                      <span class="muted"> · {{ toLocalTime(comment.timestamp) }}</span>
                    </div>
                    <div class="comment-text">{{ comment.text }}</div>
                    <button class="reply-btn small" @click="startReply(m.id, comment.id, displayName(comment.author))">回复</button>
                  </div>
                  
                  <div v-if="getReplies(m.id, comment.id).length > 0" class="replies-list">
                    <div v-for="reply in getReplies(m.id, comment.id)" :key="reply.id" class="comment-item reply-item">
                      <div class="comment-header small">
                        <strong>{{ displayName(reply.author) }}</strong>
                        <span class="muted"> · {{ toLocalTime(reply.timestamp) }}</span>
                      </div>
                      <div class="comment-text">{{ reply.text }}</div>
                    </div>
                  </div>
                </div>
                <div v-if="getComments(m.id).length === 0" class="small muted">暂无评论</div>
              </div>
              
              <div class="comment-input-container">
                <div v-if="replyingTo[m.id]" class="replying-indicator small">
                  <span>正在回复...</span>
                  <button class="cancel-reply-btn" @click="cancelReply(m.id)">✕</button>
                </div>
                <div class="comment-input-wrapper">
                  <input 
                    v-model="commentInputs[m.id]" 
                    class="comment-input" 
                    placeholder="写下你的评论..."
                    :data-message-id="m.id"
                    @keyup.enter="addComment(m.id)"
                  />
                  <button class="comment-submit" @click="addComment(m.id)" :disabled="!commentInputs[m.id]?.trim()">发送</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="hasMore" class="load-more-container">
        <button class="load-more-btn" @click="loadMoreMessages" :disabled="isLoadingMore">
          <span v-if="!isLoadingMore">加载更多 (还有 {{ remainingMessagesCount }} 条)</span>
          <span v-else>加载中...</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from "vue";
import { useFriendsStore } from "@/stores/friends";
import { useKeyStore } from "@/stores/keys";
import { pool, getRelaysFromStorage, subscribe } from "@/nostr/relays";
import { useMessagesStore } from "@/stores/messages";
import { useInteractionsStore } from "@/stores/interactions";
import { logger } from "@/utils/logger";
import { formatRelativeTime } from "@/utils/format";
import PostImagePreview from "@/components/PostImagePreview.vue";
import VideoPlayer from "@/components/VideoPlayer.vue";
import { useRoute } from "vue-router";
import { usePullToRefresh } from "@/components/usePullToRefresh";
import { getLastSeenCreatedAt, updateLastSeenToNewest } from "@/utils/lastSeen";
import { extractVideoData as extractVideoDataUtil, getVideoUrlRemovalPatterns } from "@/utils/videoUtils";

export default defineComponent({
  name: "Home",
  components: { PostImagePreview, VideoPlayer },
  setup() {
    const friends = useFriendsStore();
    const keys = useKeyStore();
    const msgs = useMessagesStore();
    const interactions = useInteractionsStore();
    const route = useRoute();

    // 状态锁
    const loadingStore = ref(true);
    const refreshing = ref(false);
    
    // 消息数据
    const messagesRef = ref<any[]>([]);
    const displayedMessages = ref<any[]>([]);
    const pendingMessages = ref<any[]>([]);
    const lastSeenCreatedAt = ref(0);

    // UI 状态
    const showingComments = ref<Set<string>>(new Set());
    const showingSendMeta = ref<Set<string>>(new Set());
    const commentInputs = ref<Record<string, string>>({});
    const replyingTo = ref<Record<string, string>>({});
    const replyingToAuthor = ref<Record<string, string>>({});

    // 分页
    const PAGE_SIZE = 20;
    const currentPage = ref(1);
    const isLoadingMore = ref(false);

    const hasMore = computed(() => messagesRef.value.length > displayedMessages.value.length);
    const remainingMessagesCount = computed(() => messagesRef.value.length - displayedMessages.value.length);

    // 1. 初始化逻辑 (核心修复)
    onMounted(async () => {
      try {
        if (!keys.pkHex) {
          await keys.load();
        }
        
        if (keys.pkHex) {
          // 必须等待所有 Store 加载完成
          await Promise.all([
            friends.load(keys.pkHex),
            msgs.load(),
            interactions.load()
          ]);
          
          lastSeenCreatedAt.value = getLastSeenCreatedAt(keys.pkHex);
          updateLocalRefs();
          
          // 初始显示第一页
          if (messagesRef.value.length > 0) {
            displayedMessages.value = messagesRef.value.slice(0, PAGE_SIZE);
          }
        }
      } catch (e) {
        logger.error("Home initialization failed", e);
      } finally {
        loadingStore.value = false;
        startSub();
        if (route.query.mid) handleNotificationJump();
      }
    });

    // 2. 数据更新逻辑
    function updateLocalRefs() {
      // 这里的 msgs.inbox 需要确保在 store 已经 load 之后才是有意义的
      messagesRef.value = [...msgs.inbox].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    function showPendingMessages() {
      const sortedPending = [...pendingMessages.value].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      // 合并并去重
      const combined = [...sortedPending, ...displayedMessages.value];
      displayedMessages.value = Array.from(new Map(combined.map(m => [m.id, m])).values())
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      
      lastSeenCreatedAt.value = updateLastSeenToNewest(keys.pkHex, displayedMessages.value);
      pendingMessages.value = [];
    }

    function loadMoreMessages() {
      if (isLoadingMore.value || !hasMore.value) return;
      isLoadingMore.value = true;
      setTimeout(() => {
        const start = displayedMessages.value.length;
        const nextBatch = messagesRef.value.slice(start, start + PAGE_SIZE);
        displayedMessages.value = [...displayedMessages.value, ...nextBatch];
        isLoadingMore.value = false;
        currentPage.value++;
      }, 200);
    }

    // 3. 互动逻辑 (增加防御性代码)
    const isLiked = (id: string) => {
      if (!keys.pkHex || !interactions.interactions) return false;
      return interactions.isLikedByUser(id, keys.pkHex);
    };

    const getLikeCount = (id: string) => {
      return interactions.getLikeCount?.(id) || 0;
    };

    const getCommentCount = (id: string) => {
      return interactions.getCommentCount?.(id) || 0;
    };

    const getComments = (id: string) => {
      return (interactions.getComments?.(id) || []).filter((c: any) => !c.parentCommentId);
    };

    const getReplies = (mid: string, cid: string) => {
      return interactions.getReplies?.(mid, cid) || [];
    };

    async function toggleLike(m: any) {
      if (!keys.pkHex) return;
      try {
        if (isLiked(m.id)) {
          await interactions.removeLike(m.id, m.pubkey);
        } else {
          await interactions.sendLike(m.id, m.pubkey);
        }
      } catch (e) { logger.error("Like error", e); }
    }

    // 4. 其他辅助
    const displayName = (pk: string) => {
      if (!pk) return "未知";
      if (pk === keys.pkHex) return "自己";
      const f = (friends.list || []).find((x: any) => x.pubkey === pk);
      return (f?.name?.trim()) ? f.name : pk.slice(0, 8);
    };

    const toLocalTime = (ts: number) => formatRelativeTime(ts);
    const textWithoutVideos = (c: string) => {
      if (!c) return "";
      return c.replace(/!\[[^\]]*?\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi, "")
              .replace(/(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|avif|svg))/gi, "")
              .replace(/\[video:(\{[^\]]+\})\]/g, "").trim();
    };
    const extractVideoData = (c: string) => extractVideoDataUtil(c);

    // UI 开关
    function toggleComments(id: string) {
      showingSendMeta.value.delete(id);
      if (showingComments.value.has(id)) showingComments.value.delete(id);
      else {
        showingComments.value.clear();
        showingComments.value.add(id);
      }
      showingComments.value = new Set(showingComments.value);
    }

    function toggleSendMeta(id: string) {
      showingComments.value.delete(id);
      if (showingSendMeta.value.has(id)) showingSendMeta.value.delete(id);
      else {
        showingSendMeta.value.clear();
        showingSendMeta.value.add(id);
      }
      showingSendMeta.value = new Set(showingSendMeta.value);
    }

    // 订阅逻辑
    let sub: any = null;
    async function startSub() {
      if (sub) sub.unsub();
      const relays = getRelaysFromStorage();
      const friendPks = (friends.list || []).map(f => f.pubkey);
      const authors = Array.from(new Set([...friendPks, keys.pkHex]));
      
      sub = pool.subscribeMany(relays, [
        { kinds: [8964], authors, since: Math.floor(Date.now()/1000) - 3600 },
        { kinds: [8965], "#p": [keys.pkHex] }
      ], {
        onevent(evt) {
          if (evt.kind === 8964) {
             // 逻辑：如果是自己的消息立即显示，别人的消息进 pending
             // 简化处理：直接交给 store，然后 updateLocalRefs
             // 此处需根据你的业务需求细化
          } else if (evt.kind === 8965) {
             interactions.processInteractionEvent(evt, keys.pkHex);
          }
        }
      });
    }

    // 下拉刷新适配
    const { container, pullDistance } = usePullToRefresh({
      onRefresh: async () => {
        refreshing.value = true;
        await startSub();
        refreshing.value = false;
      }
    });

    // 通知跳转逻辑
    async function handleNotificationJump() {
      const mid = route.query.mid as string;
      const iid = route.query.iid as string;
      if (!mid) return;
      
      await nextTick();
      const el = document.getElementById(`msg-${mid}`);
      if (el) {
        if (iid) {
          showingComments.value.add(mid);
          showingComments.value = new Set(showingComments.value);
        }
        el.scrollIntoView({ behavior: 'smooth' });
        el.classList.add("highlight");
        setTimeout(() => el.classList.remove("highlight"), 2000);
      }
    }

    return {
      loadingStore, keys, displayedMessages, pendingMessages,
      showingComments, showingSendMeta, commentInputs, replyingTo,
      hasMore, isLoadingMore, remainingMessagesCount,
      container, pullDistance, refreshing,
      displayName, toLocalTime, textWithoutVideos, extractVideoData,
      isLiked, getLikeCount, getCommentCount, getComments, getReplies,
      toggleLike, toggleComments, toggleSendMeta, loadMoreMessages, showPendingMessages
    };
  }
});
</script>

<style scoped>
.loading-screen {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 80vh;
  font-size: 0.9rem;
  color: var(--muted);
}
.highlight {
  animation: pulse 2s;
}
@keyframes pulse {
  0% { background-color: transparent; }
  50% { background-color: rgba(var(--primary-rgb), 0.1); }
  100% { background-color: transparent; }
}
/* 其他样式参考你原有的 CSS */
</style>
