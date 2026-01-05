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
.home-container {
  position: relative;
  min-height: 100vh;
  overscroll-behavior: contain;
  padding-bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom));
}


.refresh-icon {
  font-size: 24px;
  margin-bottom: 8px;
  transition: transform 0.3s ease;
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.refresh-text {
  font-size: 14px;
  color: #64748b;
  font-weight: 500;
}

.new-messages-notification {
  position: sticky;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 10px 20px;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  z-index: 999;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 12px;
  animation: slideDown 0.3s ease;
  transition: all 0.2s;
  width: fit-content;
  max-width: calc(100% - 24px);
}

.new-messages-notification:hover {
  transform: translateX(-50%) scale(1.02);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.new-messages-notification:active {
  transform: translateX(-50%) scale(0.98);
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.notification-icon {
  font-size: 16px;
  animation: bounce 1s ease infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

.notification-text {
  font-size: 14px;
}

.small { font-size:12px; color:#64748b; }
.card { background: #fff; padding:12px; border-radius:10px; margin-bottom:12px; box-shadow: 0 4px 10px rgba(0,0,0,0.04); }
.list { display:flex; flex-direction:column; gap:8px; }
.muted { color: #94a3b8; font-size: 12px; margin-left:6px; }
.message-text {
  margin-top: 8px;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.message-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
}

.message-expanded {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}


.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 8px;
  transition: all 0.2s;
  font-size: 14px;
  color: #64748b;
}

.action-btn:hover {
  background: #f8fafc;
}

.action-btn.liked {
  color: #ef4444;
}

.action-icon {
  font-size: 16px;
}

.action-text {
  font-size: 13px;
}

.comments-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f1f5f9;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
  max-height: 300px;
  overflow-y: auto;
}

.comment-item {
  background: #f8fafc;
  padding: 8px;
  border-radius: 6px;
}

.comment-header {
  margin-bottom: 4px;
}

.comment-text {
  font-size: 13px;
  color: #1e293b;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
}

.comment-input {
  flex: 1;
  min-width: 0; /* Allow flex item to shrink below its content size */
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  /* Prevent iOS zoom on focus */
  font-size: 16px;
  box-sizing: border-box;
  max-width: 100%;
  width: 100%;
  /* Better mobile input handling */
  -webkit-appearance: none;
  touch-action: manipulation;
}

.comment-input:focus {
  outline: none;
  border-color: #1976d2;
}

.comment-submit {
  background: #1976d2;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  flex-shrink: 0; /* Prevent button from shrinking */
  white-space: nowrap; /* Prevent text wrapping */
}

.comment-submit:hover:not(:disabled) {
  background: #1565c0;
}

.comment-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.reply-btn {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 4px 0;
  margin-top: 4px;
  font-size: 12px;
  transition: color 0.2s;
}

.reply-btn:hover {
  color: #1976d2;
}

.comment-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.replies-list {
  margin-left: 24px;
  padding-left: 12px;
  border-left: 2px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reply-item {
  background: #ffffff;
  border: 1px solid #e2e8f0;
}

.replying-indicator {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: #eff6ff;
  border-radius: 6px;
  margin-bottom: 4px;
  color: #1976d2;
}

.cancel-reply-btn {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 0 4px;
  font-size: 14px;
  transition: color 0.2s;
}

.cancel-reply-btn:hover {
  color: #dc2626;
}

.comment-input-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.comment-input-wrapper {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
}

.send-meta {
  margin-left: auto;   /* ⭐ 推到最右 */
  position: relative;
}
.send-btn {
  padding: 6px 12px;   /* 和 action-btn 保持一致 */
}


.send-meta-panel {
  margin-top: 8px;
  padding: 10px 12px;
  background: #f8fafc;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
}

.send-meta-title {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 6px;
}

.send-meta-groups {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.send-meta-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.group-name {
  color: #0f172a;
}

.group-count {
  color: #64748b;
}
.highlight {
  animation: flash 1.5s ease;
}

@keyframes flash {
  0%   { background: rgba(59,130,246,0.15); }
  100% { background: transparent; }
}

.pull-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: #666;
  transition: height 0.2s ease;
  overflow: hidden;
  position: sticky;
  top: 0;
  z-index: 10;
}

.load-more-container {
  display: flex;
  justify-content: center;
  padding: var(--load-more-padding) 12px;
}

.load-more-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  transition: all 0.2s;
}

.load-more-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
}

.load-more-btn:active:not(:disabled) {
  transform: translateY(0);
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.message-text-top {
  margin-bottom: 8px;
}
.post-images {
  margin-top: 0;
}
</style>
