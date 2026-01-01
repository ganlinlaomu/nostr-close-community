<template>
  <div 
    class="home-container" ref="container"
  >
    <div
      class="pull-indicator"
      :style="{ height: pullDistance + 'px' }"
    >
      <span v-if="!refreshing">↓ 下拉刷新</span>
      <span v-else>⟳ 刷新中...</span>
    </div>
    
    <!-- New messages notification - only show on PC/desktop (non-touch devices) -->
    <div 
      v-if="pendingMessages.length > 0" 
      class="new-messages-notification" 
      role="button"
      tabindex="0"
      :aria-label="`有 ${pendingMessages.length} 条新消息，点击查看`"
      @click="showPendingMessages"
      @keyup.enter="showPendingMessages"
      @keyup.space.prevent="showPendingMessages"
    >
      <span class="notification-icon">↓</span>
      <span class="notification-text">{{ pendingMessages.length }} 条新消息</span>
    </div>


    <div class="card">
      <h4 style="margin: 0 0 12px 0;">好友动态</h4>
      <div v-if="displayedMessages.length === 0" class="small">还没有消息</div>
      
      <div class="list">
        <div v-for="m in displayedMessages" :key="m.id" :id="`msg-${m.id}`" class="card">
          <div class="small">
            {{ displayName(m.pubkey) }}
            <span class="muted"> · {{ toLocalTime(m.created_at) }}</span>
          </div>

          <!-- 图片预览（9宫格展示多图） -->
          <PostImagePreview :content="m.content" :showAll="true" :max="9" style="margin-top:8px;" />

          <!-- 如果仍需显示文本（去除了图片 URL/Markdown），使用 textWithoutImages -->
          <div v-if="textWithoutImages(m.content)" class="message-text">{{ textWithoutImages(m.content) }}</div>
          
          <!-- 操作按钮：点赞和评论 -->
          <div class="message-actions">
            <button class="action-btn" @click="toggleLike(m)" :class="{ 'liked': isLiked(m.id) }">
              <span class="action-icon">{{ isLiked(m.id) ? '❤️' : '🤍' }}</span>
              <span class="action-text">{{ getLikeCount(m.id) }}</span>
            </button>
            <button class="action-btn" @click="toggleComments(m.id)">
              <span class="action-icon">💬</span>
              <span class="action-text">{{ getCommentCount(m.id) }}</span>
            </button>
            <!-- SEND META (only author) -->
            <div v-if="m._localMeta?.groupCount" class="send-meta">
             <button
               class="action-btn send-btn"
               @click="toggleSendMeta(m.id)"
             >
               <span class="action-icon">👀</span>
               <span class="action-text">{{ m._localMeta.groupCount }}</span>
            </button>
          </div>

          </div>
<div class="message-expanded">

           <!-- SEND META EXPANDED (like comments) -->
<div
  v-if="showingSendMeta.has(m.id)"
  class="send-meta-panel"
>
  <div class="send-meta-title">对谁可见:</div>

  <div class="send-meta-groups">
    <div
      v-for="g in m._localMeta.groups"
      :key="g.name"
      class="send-meta-row"
    >
      <span class="group-name">{{ g.name }}</span>
      <span class="group-count">{{ g.count }} 人</span>
    </div>
  </div>
</div>

          <!-- 评论区域 -->
          <div v-if="showingComments.has(m.id)" class="comments-section">
            <div class="comments-list">
              <div v-for="comment in getComments(m.id)" :key="comment.id"  class="comment-thread">
                <!-- 主评论 -->
                <div class="comment-item" :id="`comment-${comment.id}`">
                  <div class="comment-header small">
                    <strong>{{ displayName(comment.author) }}</strong>
                    <span class="muted"> · {{ toLocalTime(comment.timestamp) }}</span>
                  </div>
                  <div class="comment-text">{{ comment.text }}</div>
                  <button class="reply-btn small" @click="startReply(m.id, comment.id, displayName(comment.author))">
                    回复
                  </button>
                </div>
                
                <!-- 回复列表 -->
                <div v-if="getReplies(m.id, comment.id).length > 0" class="replies-list">
                  <div v-for="reply in getReplies(m.id, comment.id)" :key="reply.id" class="comment-item reply-item">
                    <div class="comment-header small">
                      <strong>{{ displayName(reply.author) }}</strong>
                      <span class="muted"> · {{ toLocalTime(reply.timestamp) }}</span>
                    </div>
                    <div class="comment-text">{{ reply.text }}</div>
                    <!-- 不显示回复按钮，因为只支持两层评论 -->
                  </div>
                </div>
              </div>
              <div v-if="getComments(m.id).length === 0" class="small muted">暂无评论</div>
            </div>
            
            <!-- 评论输入框 -->
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
                <button class="comment-submit" @click="addComment(m.id)" :disabled="!commentInputs[m.id]?.trim()">
                  发送
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
      
      <!-- Bottom sentinel for scroll detection -->
      <div ref="bottomSentinelRef" class="bottom-sentinel"></div>
      
      <!-- Show older messages button - only appears when at bottom -->
      <div v-if="hasOlderLocalMessages && atBottom" class="show-older-container">
        <button class="show-older-btn" @click="showOlderLocalMessages">
          <span class="show-older-icon">📜</span>
          <span class="show-older-text">显示更早消息（本地）</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from "vue";
import { useFriendsStore } from "@/stores/friends";
import { useKeyStore } from "@/stores/keys";
import { getRelaysFromStorage, subscribe } from "@/nostr/relays";
import { symDecryptPackage } from "@/nostr/crypto";
import { useMessagesStore, type InboxItem } from "@/stores/messages";
import { useInteractionsStore } from "@/stores/interactions";
import { logger } from "@/utils/logger";
import { formatRelativeTime } from "@/utils/format";
import PostImagePreview from "@/components/PostImagePreview.vue";
import { backfillEvents, saveBackfillBreakpoint, loadBackfillBreakpoint } from "@/utils/backfill";
import { useRoute } from "vue-router";
import { usePullToRefresh } from "@/components/usePullToRefresh";


// reuse the regex logic from extractImageUrls to strip out image markdown and plain image URLs
const mdImageRE = /!\[[^\]]*?\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
const plainImgUrlRE = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s)]*)?)/gi;
// Match encrypted image references in markdown: ![](blossom+aesgcm:...)
// This is needed to prevent raw encrypted markdown from appearing in the message text area
// while PostImagePreview handles the actual decryption and rendering
const mdEncryptedImageRE = /!\[[^\]]*?\]\(\s*(blossom\+aesgcm:[^\s)]+)\s*\)/gi;

// Constants for time calculations
const SECONDS_PER_DAY = 24 * 60 * 60;
const THREE_DAYS_IN_SECONDS = 3 * SECONDS_PER_DAY;

export default defineComponent({
  name: "Home",
  components: { PostImagePreview },
  setup() {
    const friends = useFriendsStore();
    const keys = useKeyStore();
    const msgs = useMessagesStore();
    const interactions = useInteractionsStore();
    const readyForPending = ref(false);
    const route = useRoute();
    const notificationJumpDone = ref(false);


    const status = ref("未连接");
    let sub: any = null;
    let interactionsSub: any = null;

    const messagesRef = ref([] as any[]);
    const displayedMessages = ref([] as any[]);
    const pendingMessages = ref([] as any[]); // Messages fetched but not yet displayed
    const isInitialLoad = ref(true); // Track if this is the first load
    const showingSendMeta = ref<Set<string>>(new Set());
    const isBackfilling = ref(false); // Track if currently backfilling (vs realtime)
    const showOlderLocal = ref(false); // Whether to show older local messages
    const atBottom = ref(false); // Track if user has scrolled to bottom of message list
    const bottomObserver = ref<IntersectionObserver | null>(null); // IntersectionObserver for bottom detection
    const bottomSentinelRef = ref<HTMLElement | null>(null); // Template ref for bottom sentinel element

    // Computed property to check if there are older messages beyond the 3-day window
    const hasOlderLocalMessages = computed(() => {
      if (showOlderLocal.value) return false; // Already showing older messages
      if (displayedMessages.value.length === 0) return false;
      
      const now = Math.floor(Date.now() / 1000);
      const threeDaysAgo = now - THREE_DAYS_IN_SECONDS;
      
      // Check if there are any messages in inbox that are older than 3 days and not currently displayed
      const displayedIds = new Set(displayedMessages.value.map(m => m.id));
      const olderMessages = msgs.inbox.filter(m => 
        (m.created_at || 0) < threeDaysAgo && !displayedIds.has(m.id)
      );
      
      return olderMessages.length > 0;
    });
    
    // State for comments UI
    const showingComments = ref<Set<string>>(new Set());
    const commentInputs = ref<Record<string, string>>({});
    const replyingTo = ref<Record<string, string>>({}); // messageId -> commentId being replied to
    const replyingToAuthor = ref<Record<string, string>>({}); // messageId -> author pubkey of comment being replied to
    
    // State for message time range display
    const messageTimeRange = ref<string>("");
    
    
    function showPendingMessages() {
      if (pendingMessages.value.length > 0) {
        logger.info(`手动显示 ${pendingMessages.value.length} 条待显示消息`);
        // Sort pending messages first
        const sortedPending = [...pendingMessages.value].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        // Use efficient merge since both arrays are already sorted
        const merged: any[] = [];
        let i = 0, j = 0;
        while (i < sortedPending.length || j < displayedMessages.value.length) {
          if (i >= sortedPending.length) {
            merged.push(...displayedMessages.value.slice(j));
            break;
          }
          if (j >= displayedMessages.value.length) {
            merged.push(...sortedPending.slice(i));
            break;
          }
          if ((sortedPending[i].created_at || 0) >= (displayedMessages.value[j].created_at || 0)) {
            merged.push(sortedPending[i++]);
          } else {
            merged.push(displayedMessages.value[j++]);
          }
        }
        displayedMessages.value = merged;
        pendingMessages.value = [];
        updateMessageTimeRange();
      }
    }
    
    function showOlderLocalMessages() {
      logger.info("[显示更早消息] 合并本地缓存的更早消息");
      showOlderLocal.value = true;
      
      // Get all messages from local cache, sorted by time
      const allLocalMessages = [...msgs.inbox].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      
      // Find messages that are not currently displayed
      const displayedIds = new Set(displayedMessages.value.map(m => m.id));
      const olderMessages = allLocalMessages.filter(m => !displayedIds.has(m.id));
      
      if (olderMessages.length > 0) {
        logger.info(`找到 ${olderMessages.length} 条更早的本地消息`);
        // Simply append older messages and sort (displayedIds Set already ensures no duplicates)
        displayedMessages.value = [...displayedMessages.value, ...olderMessages].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        updateMessageTimeRange();
      } else {
        logger.info("没有更早的本地消息");
      }
    }
    
    
    
    function updateLocalRefs() {
      // Sort messages by timestamp descending (newest first)
      messagesRef.value = [...msgs.inbox].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      
      // Check for new messages that aren't currently displayed
      const displayedIds = new Set(displayedMessages.value.map(m => m.id));
      const pendingIds = new Set(pendingMessages.value.map(m => m.id));
      const newMessages = messagesRef.value.filter(m => !displayedIds.has(m.id) && !pendingIds.has(m.id));
      
      if (newMessages.length > 0 && readyForPending.value) {
        // Separate own messages from others' messages using filter for better readability
        const ownMessages: InboxItem[] = newMessages.filter(msg => msg.pubkey === keys.pkHex);
        const othersMessages: InboxItem[] = newMessages.filter(msg => msg.pubkey !== keys.pkHex);
        
        // Own messages: insert directly into displayedMessages (immediate display)
        if (ownMessages.length > 0) {
          logger.info(`收到 ${ownMessages.length} 条自己的新消息，立即显示`);
          // Sort own messages first
          const sortedOwn = ownMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          // Merge with displayedMessages using efficient sorted merge
          const merged: InboxItem[] = [];
          let i = 0, j = 0;
          while (i < sortedOwn.length || j < displayedMessages.value.length) {
            if (i >= sortedOwn.length) {
              merged.push(...displayedMessages.value.slice(j));
              break;
            }
            if (j >= displayedMessages.value.length) {
              merged.push(...sortedOwn.slice(i));
              break;
            }
            if ((sortedOwn[i].created_at || 0) >= (displayedMessages.value[j].created_at || 0)) {
              merged.push(sortedOwn[i++]);
            } else {
              merged.push(displayedMessages.value[j++]);
            }
          }
          displayedMessages.value = merged;
        }
        
        // Others' messages: handle differently based on backfill state
        if (othersMessages.length > 0) {
          if (isBackfilling.value) {
            // During backfill: add directly to displayedMessages (within 3-day window), don't count as pending
            logger.info(`[回填阶段] 收到 ${othersMessages.length} 条其他用户的消息，直接显示（不计入🆕）`);
            const sortedOthers = othersMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            const merged: InboxItem[] = [];
            let i = 0, j = 0;
            while (i < sortedOthers.length || j < displayedMessages.value.length) {
              if (i >= sortedOthers.length) {
                merged.push(...displayedMessages.value.slice(j));
                break;
              }
              if (j >= displayedMessages.value.length) {
                merged.push(...sortedOthers.slice(i));
                break;
              }
              if ((sortedOthers[i].created_at || 0) >= (displayedMessages.value[j].created_at || 0)) {
                merged.push(sortedOthers[i++]);
              } else {
                merged.push(displayedMessages.value[j++]);
              }
            }
            displayedMessages.value = merged;
          } else {
            // Realtime stage: add to pending queue (wait for explicit refresh)
            logger.info(`[实时阶段] 收到 ${othersMessages.length} 条其他用户的新消息，计入🆕等待刷新显示`);
            // Sort other messages by timestamp (newest first) before adding
            const sortedOthers = othersMessages.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
            // Merge with existing pending messages, de-duplicate by id, and keep sorted
            const combined = [...sortedOthers, ...pendingMessages.value];
            const deduped = Array.from(new Map(combined.map(m => [m.id, m])).values());
            pendingMessages.value = deduped.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
          }
        }
      }
      
      updateMessageTimeRange();
       }
    const {
       container,
       pullDistance,
       refreshing
    } = usePullToRefresh({
      onRefresh: async () => {
        // Light refresh: just show pending messages, don't rebuild subscription
        logger.info("[轻刷新] 合并pending消息到显示列表");
        showPendingMessages();
      }
    });

    function updateMessageTimeRange() {
      if (displayedMessages.value.length === 0) {
        messageTimeRange.value = "";
        return;
      }
      
      // Calculate oldest and newest in displayed messages
      const { oldest, newest } = displayedMessages.value.reduce((acc, msg) => {
        const ts = msg?.created_at || 0;
        if (ts > 0) {
          if (acc.oldest === 0 || ts < acc.oldest) {
            acc.oldest = ts;
          }
          if (ts > acc.newest) {
            acc.newest = ts;
          }
        }
        return acc;
      }, { oldest: 0, newest: 0 });
      
      if (oldest > 0 && newest > 0) {
        const oldestDate = new Date(oldest * 1000);
        const newestDate = new Date(newest * 1000);
        messageTimeRange.value = `${oldestDate.toLocaleDateString('zh-CN')} - ${newestDate.toLocaleDateString('zh-CN')}`;
      }
    }

    const toLocalTime = (ts: number) => formatRelativeTime(ts);
    const shortPub = (s: string) => (s ? s.slice(0, 8) + "..." : "");
    const shortRelay = (r: string) => (r ? r.replace(/^wss?:\/\//, "").replace(/\/$/, "").slice(0, 22) : "");

    function displayName(pubkey: string) {
      if (!pubkey) return "未知用户";
      if (keys.pkHex && pubkey === keys.pkHex) return "自己";
      const f = (friends.list || []).find((x: any) => x.pubkey === pubkey);
      if (f && f.name && String(f.name).trim().length > 0) return f.name;
      // Return shortened public key as fallback
      return pubkey.slice(0, 8) + "...";
    }

    function addMessageIfNew(evt: any, plain: string) {
      if (!evt || !evt.id) return false;
      
      // Check if message already exists in inbox
      const existing = msgs.inbox.find((m) => m.id === evt.id);
      if (existing) {
        // Message already exists - the stores layer (addInbox) handles preservation
        // of _localMeta, so we just return false to skip adding this duplicate
        return false;
      }
      
      // Add new message to inbox
      const added = { id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, content: plain };
      msgs.addInbox(added);
      nextTick(() => {
        updateLocalRefs();
      });
      return true;
    }

    function textWithoutImages(content: string): string {
      if (!content) return "";
      // remove markdown image ![alt](url)
      let s = content.replace(mdImageRE, "");
      // remove encrypted image markdown ![](blossom+aesgcm:...)
      s = s.replace(mdEncryptedImageRE, "");
      // remove plain image urls
      s = s.replace(plainImgUrlRE, "");
      // collapse multiple blank lines and trim
      s = s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return s;
    }

    // Like functionality
    async function toggleLike(message: any) {
      if (!keys.pkHex) return;
      
      const messageId = message.id;
      const isCurrentlyLiked = interactions.isLikedByUser(messageId, keys.pkHex);
      
      try {
        if (isCurrentlyLiked) {
          await interactions.removeLike(messageId, message.pubkey);
        } else {
          await interactions.sendLike(messageId, message.pubkey);
        }
      } catch (e: any) {
        logger.error("Toggle like failed", e);
      }
    }

    function isLiked(messageId: string): boolean {
      if (!keys.pkHex) return false;
      return interactions.isLikedByUser(messageId, keys.pkHex);
    }

    function getLikeCount(messageId: string): number {
      return interactions.getLikeCount(messageId);
    }

    function toggleSendMeta(messageId: string) {
  // ⭐ 关闭评论
  showingComments.value.delete(messageId);

  if (showingSendMeta.value.has(messageId)) {
    showingSendMeta.value.delete(messageId);
  } else {
    showingSendMeta.value.clear();
    showingSendMeta.value.add(messageId);
  }

  showingSendMeta.value = new Set(showingSendMeta.value);
  showingComments.value = new Set(showingComments.value);
}



    // Comment functionality
    function toggleComments(messageId: string) {
     // ⭐ 关闭 send-meta
     showingSendMeta.value.delete(messageId);

     if (showingComments.value.has(messageId)) {
        showingComments.value.delete(messageId);
     } else {
       showingComments.value.clear();
       showingComments.value.add(messageId);
     }

     showingComments.value = new Set(showingComments.value);
     showingSendMeta.value = new Set(showingSendMeta.value);
    }

    async function addComment(messageId: string) {
      if (!keys.pkHex) return;
      const text = commentInputs.value[messageId]?.trim();
      if (!text) return;

      // Find the message to get the author
      const message = msgs.inbox.find((m) => m.id === messageId);
      if (!message) return;

      try {
        const parentCommentId = replyingTo.value[messageId];
        // Determine recipient: if replying to a comment, send to comment author; otherwise send to post author
        const recipient = replyingToAuthor.value[messageId] || message.pubkey;
        await interactions.sendComment(messageId, recipient, text, parentCommentId);
        // Clear input and reply state
        commentInputs.value[messageId] = "";
        replyingTo.value[messageId] = "";
        replyingToAuthor.value[messageId] = "";
      } catch (e: any) {
        logger.error("Add comment failed", e);
      }
    }

    function getHashQuery() {
  const hash = window.location.hash; // "#/?mid=xxx&iid=yyy"
  const idx = hash.indexOf("?");
  if (idx === -1) return {};
  const qs = new URLSearchParams(hash.slice(idx + 1));
  return Object.fromEntries(qs.entries());
}


  async function handleNotificationJump() {
  const q = getHashQuery();
  const mid = q.mid as string | undefined;
  const iid = q.iid as string | undefined;
 


  if (!mid) return;

  // ① 等消息本身存在（点赞能跳就是靠这个）
  const waitForMessage = async () => {
    for (let i = 0; i < 20; i++) {
      if (displayedMessages.value.some(m => m.id === mid)) return true;
      await new Promise(r => setTimeout(r, 50));
    }
    return false;
  };

  const msgReady = await waitForMessage();
  if (!msgReady) {
    console.warn("通知跳转失败：消息未出现", mid);
    return;
  }

  // ② 如果是评论，强制展开评论区
  if (iid) {
    showingComments.value.add(mid);
    showingComments.value = new Set(showingComments.value);
  }

  // ③ 等评论 DOM 真正渲染出来（核心）
  const targetId = iid ? `comment-${iid}` : `msg-${mid}`;

  const waitForElement = async () => {
    for (let i = 0; i < 40; i++) {
      const el = document.getElementById(targetId);
      if (el) return el;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  };

  const el = await waitForElement();

  if (!el) {
    console.warn("通知跳转失败：DOM 未找到", targetId);
    return;
  }

  // ④ 滚动 + 高亮
  el.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  el.classList.add("highlight");
  setTimeout(() => el.classList.remove("highlight"), 1500);
  notificationJumpDone.value = true;
    
}




    function startReply(messageId: string, commentId: string, authorName: string) {
      replyingTo.value[messageId] = commentId;
      commentInputs.value[messageId] = `@${authorName} `;
      
      // Find the comment to get its author pubkey
      // Note: interactions.getComments() returns ALL comments (including nested replies)
      const allComments = interactions.getComments(messageId);
      const comment = allComments.find((c: any) => c.id === commentId);
      if (comment) {
        replyingToAuthor.value[messageId] = comment.author;
      } else {
        logger.warn("Could not find comment to reply to", { messageId, commentId });
      }
      
      // Focus input after state update
      setTimeout(() => {
        const input = document.querySelector(`input[data-message-id="${messageId}"]`) as HTMLInputElement;
        if (input) input.focus();
      }, 100);
    }

    function cancelReply(messageId: string) {
      replyingTo.value[messageId] = "";
      replyingToAuthor.value[messageId] = "";
      commentInputs.value[messageId] = "";
    }

    function getComments(messageId: string) {
      // Get only top-level comments (no parent)
      return interactions.getComments(messageId).filter((c: any) => !c.parentCommentId);
    }

    function getReplies(messageId: string, commentId: string) {
      return interactions.getReplies(messageId, commentId);
    }

    function getCommentCount(messageId: string): number {
      return interactions.getCommentCount(messageId);
    }
    
    async function backfillMessages(friendSet: Set<string>, relays: string[]) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const breakpointKey = `messages_${keys.pkHex}`;
        const savedBreakpoint = loadBackfillBreakpoint(breakpointKey); 
        // Determine time range for backfill - always use 3-day window
        let since: number;
        let until: number = now;
        
        if (savedBreakpoint && savedBreakpoint > 0) {
          since = savedBreakpoint + 1;
          logger.info(
            `use backfillpoint to pull: since=${new Date(since * 1000).toLocaleString()}`
          );
        } else {
          since = now - THREE_DAYS_IN_SECONDS;
          logger.info(
          `no backfillpoint,pull three days: since=${new Date(since * 1000).toLocaleString()}`
          );
        }
        
        logger.info(`回填参数: kinds=[8964], authors数量=${friendSet.size}, since=${new Date(since * 1000).toLocaleString()}, until=${new Date(until * 1000).toLocaleString()}`);
        logger.debug(`好友列表: ${Array.from(friendSet).slice(0, 5).map(pk => pk.slice(0, 8)).join(', ')}${friendSet.size > 5 ? `... (共${friendSet.size}个)` : ''}`);
        
        status.value = "获取历史消息中...";
        
        // Track decryption statistics
        let fetchedEvents = 0;
        let decryptedEvents = 0;
        let notForMe = 0;
        let parseErrors = 0;
        let decryptErrors = 0;
        let notFromFriends = 0;
        let newestTimestamp = 0;
        
        // Process event and decrypt
        const processEvent = async (evt: any) => {
          fetchedEvents++;
          try {
            if (!friendSet.has(evt.pubkey)) {
              notFromFriends++;
              return;
            }
            
            let payload: any;
            try { 
              payload = JSON.parse(evt.content); 
            } catch { 
              parseErrors++;
              logger.warn(`事件 ${evt.id?.slice(0,8)} 解析失败: 无效的JSON`);
              return; 
            }
            
            if (!payload?.keys || !payload?.pkg) {
              parseErrors++;
              return;
            }
            
            const myEntry = payload.keys.find((k: any) => k.to === keys.pkHex);
            if (!myEntry) {
              notForMe++;
              return;
            }
            
            let symHex: string | null = null;
            try {
              symHex = await keys.nip04Decrypt(evt.pubkey, myEntry.enc);
            } catch (e) {
              logger.warn(`事件 ${evt.id?.slice(0,8)} NIP-04解密失败，尝试备用方案`, e);
              // Fallback: check if enc is already a hex key
              if (typeof myEntry.enc === "string" && /^[0-9a-fA-F]{64}$/.test(myEntry.enc)) {
                symHex = myEntry.enc;
                logger.info(`事件 ${evt.id?.slice(0,8)} 使用备用hex key`);
              } else {
                decryptErrors++;
                return;
              }
            }
            
            try {
              const plain = await symDecryptPackage(symHex, payload.pkg);
              const added = addMessageIfNew(evt, plain);
              if (added) {
                decryptedEvents++;
                // Track the newest message timestamp for breakpoint
                if (evt.created_at > newestTimestamp) {
                  newestTimestamp = evt.created_at;
                }
              }
            } catch (e) {
              decryptErrors++;
              logger.warn(`事件 ${evt.id?.slice(0,8)} 对称解密失败`, e);
            }
          } catch (e) {
            logger.error("处理回填事件失败", e);
          }
        };
        
        // Use backfill utility with batching and pagination
        const stats = await backfillEvents({
          relays,
          filters: {
            kinds: [8964],
            authors: Array.from(friendSet),
            since,
            until
          },
          onEvent: processEvent,
          onProgress: (stats) => {
            status.value = `获取中: ${stats.totalEvents} 条事件`;
          },
          onComplete: (stats) => {
            const summary = [
              `获取: ${fetchedEvents} 条`,
              `解密成功: ${decryptedEvents} 条`,
            ];
            if (notFromFriends > 0) summary.push(`非好友: ${notFromFriends} 条`);
            if (notForMe > 0) summary.push(`非自己: ${notForMe} 条`);
            if (parseErrors > 0) summary.push(`解析失败: ${parseErrors} 条`);
            if (decryptErrors > 0) summary.push(`解密失败: ${decryptErrors} 条`);
            
            const summaryText = summary.join(', ');
            logger.info(`回填完成: ${summaryText}`);
            
            if (decryptedEvents > 0) {
              status.value = `获取成功 ${decryptedEvents} 条消息`;
            } else if (fetchedEvents > 0) {
              status.value = `获取了 ${fetchedEvents} 条事件但无法解密`;
              logger.warn(`回填获取了事件但全部解密失败。可能原因: 1) 事件不是发给自己的 2) 密钥不匹配 3) 数据格式错误`);
            } else {
              status.value = "已是最新";
            }
            
            // Save the timestamp of the newest message for future reference
            // This helps track the last time we successfully fetched messages
            const breakpointKey = `messages_${keys.pkHex}`;
            if (newestTimestamp > 0) {
              saveBackfillBreakpoint(breakpointKey, newestTimestamp);
              logger.info(`保存最新消息时间戳: ${new Date(newestTimestamp * 1000).toLocaleString()}`);
            } else {
              // No new messages, save current time
              saveBackfillBreakpoint(breakpointKey, now);
            }
          },
          batchSize: 1000, // Increased batch size for more efficient fetching
          authorBatchSize: 50,
          maxBatches: 20,
          timeoutMs: 10000
        });
        
      } catch (e) {
        logger.error("回填失败", e);
        status.value = "获取消息失败";
      }
    }
    
    async function backfillInteractions(relays: string[]) {
      try {
        const now = Math.floor(Date.now() / 1000);
        const breakpointKey = `interactions_${keys.pkHex}`;
        const savedBreakpoint = loadBackfillBreakpoint(breakpointKey);
        let since: number;

        if (savedBreakpoint && savedBreakpoint > 0) {
          since = savedBreakpoint + 1;
          logger.info (
            `backfill use breakpoint: since=${new Date(since * 1000).toLocaleString()}`
          );
        } else {
          since = now - THREE_DAYS_IN_SECONDS;
          logger.info(
            `pull from three days: since=${new Date(since * 1000).toLocaleString()}`
          );
        }
      saveBackfillBreakpoint(`interactions_${keys.pkHex}`, now);  
        
        
        // Fetch using inbox (#p) and outbox (authors) filters
        // No longer using #e to avoid privacy issues
        await interactions.backfillInteractions({
          relays,
          since,
          until: now,
          maxBatches: 10,
          onProgress: (fetched, processed) => {
            logger.debug(`回填互动进度: 获取 ${fetched} 条, 处理 ${processed} 条`);
          }
        });
        saveBackfillBreakpoint(`interactions_${keys.pkHex}`, now); 
        logger.info("互动事件回填完成");
        
      } catch (e) {
        logger.error("回填互动事件失败", e);
      }
    }

    async function startSub() {
      try {
        logger.info("开始订阅流程");
        friends.load().catch(console.error);
        logger.info(`好友列表加载完成: ${friends.list.length} 个好友`);
        
        if (!keys.isLoggedIn) {
          status.value = "未登录";
          return;
        }
        await Promise.all([
          msgs.load(),
          interactions.load()
        ]);
        readyForPending.value = true;
        
        // On initial load, show only messages from the last 3 days
        const now = Math.floor(Date.now() / 1000);
        const threeDaysAgo = now - THREE_DAYS_IN_SECONDS;
        
        messagesRef.value = [...msgs.inbox].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        if (isInitialLoad.value) {
          // First time loading - show only last 3 days
          const recentMessages = messagesRef.value.filter(m => (m.created_at || 0) >= threeDaysAgo);
          displayedMessages.value = recentMessages;
          isInitialLoad.value = false;
          logger.info(`初始加载: 仅显示最近3天的 ${displayedMessages.value.length} 条消息（共 ${messagesRef.value.length} 条本地缓存）`);
        } else {
          // Subsequent refresh - new messages go to pending
          updateLocalRefs();
        }
        updateMessageTimeRange();

        const friendSet = new Set<string>((friends.list || []).map((f: any) => f.pubkey));
        if (keys.pkHex) friendSet.add(keys.pkHex);
        logger.info(`准备订阅 ${friendSet.size} 个作者（包括自己）`);
        logger.debug(`好友公钥列表: ${Array.from(friendSet).slice(0, 5).map(pk => pk.slice(0, 8)).join(', ')}${friendSet.size > 5 ? `... (共${friendSet.size}个)` : ''}`);
        
        if (friendSet.size === 0) {
          status.value = "好友为空";
          logger.warn("好友列表为空，无法订阅");
          return;
        }

        const relays = getRelaysFromStorage();
        logger.info(`使用中继: ${relays.join(', ')}`);
        
        // First, backfill historical messages - set backfilling flag
        logger.info("开始回填历史消息...");
        isBackfilling.value = true;
        
        // Await backfill to complete before starting realtime subscription
        await backfillMessages(friendSet, relays);
        
        // Backfill complete, switch to realtime mode
        isBackfilling.value = false;
        logger.info("[回填完成] 切换到实时模式");
        
        // ⭐ 从本地取回填断点（关键）
        const messageBreakpoint =
        loadBackfillBreakpoint(`messages_${keys.pkHex}`) || 0;

        const filters = {
          kinds: [8964],
          authors: Array.from(friendSet),
          since: messageBreakpoint + 1 // ⭐ 关键符号就在这里
        };

        logger.info(
          `实时订阅过滤器: kinds=[8964], authors数量=${friendSet.size}, since=${
            messageBreakpoint > 0
            ? new Date(messageBreakpoint * 1000).toLocaleString()
            : "0"
         }`
       );
        status.value = "连接中";

        try {
          if (sub) {
            logger.debug("关闭之前的订阅");
            if (typeof sub.close === "function") sub.close();
            else if (typeof sub.unsub === "function") sub.unsub();
            else if (typeof sub.unsubscribe === "function") sub.unsubscribe();
            else if (typeof sub === "function") sub();
          }
        } catch (e) {
          logger.warn("close prev sub error", e);
        }
        sub = null;

        try {
          logger.info("开始实时订阅 kind=8964 事件...");
          const adapterSub = subscribe(relays, [filters]);
          sub = adapterSub;
          adapterSub.on("event", async (evt: any) => {
            try {
              if (!friendSet.has(evt.pubkey)) return;
              let payload: any;
              try { 
                payload = JSON.parse(evt.content); 
              } catch { 
                logger.warn(`实时事件 ${evt.id?.slice(0,8)} JSON解析失败`);
                return; 
              }
              if (!payload?.keys || !payload?.pkg) return;
              const myEntry = payload.keys.find((k: any) => k.to === keys.pkHex);
              if (!myEntry) return;
              let symHex: string | null = null;
              try {
                symHex = await keys.nip04Decrypt(evt.pubkey, myEntry.enc);
              } catch (e) {
                logger.warn(`实时事件 ${evt.id?.slice(0,8)} NIP-04解密失败，尝试备用方案`, e);
                if (typeof myEntry.enc === "string" && /^[0-9a-fA-F]{64}$/.test(myEntry.enc)) {
                  symHex = myEntry.enc;
                } else {
                  return;
                }
              }
              try {
                const plain = await symDecryptPackage(symHex, payload.pkg);
                addMessageIfNew(evt, plain);
              } catch (e) {
                logger.warn(`实时事件 ${evt.id?.slice(0,8)} 对称解密失败`, e);
              }
            } catch (e) {
              logger.warn("handle event fail", e);
            }
          });
          adapterSub.on("eose", () => { status.value = "同步完成"; });

          setTimeout(() => { if (status.value === "连接中") status.value = "已订阅"; }, 800);
        } catch (e) {
          logger.warn("subscribe adapter failed", e);
          status.value = "订阅失败";
        }
        
        // Backfill historical interactions before subscribing to real-time events
        // Now uses inbox (#p) and outbox (authors) filters for privacy compliance
        // await backfillInteractions(relays);
        backfillInteractions(relays).catch(console.error);
        
        // Close existing interactions subscription before creating a new one
        try {
          if (interactionsSub) {
            logger.debug("关闭之前的互动订阅");
            if (typeof interactionsSub.close === "function") interactionsSub.close();
            else if (typeof interactionsSub.unsub === "function") interactionsSub.unsub();
            else if (typeof interactionsSub.unsubscribe === "function") interactionsSub.unsubscribe();
            else if (typeof interactionsSub === "function") interactionsSub();
          }
        } catch (e) {
          logger.warn("close prev interactions sub error", e);
        }
        interactionsSub = null;
        
        // Subscribe to interactions (kind 8965)
        try {
          // Subscribe to two types of interactions for comprehensive coverage:
          // 1. Inbox: Interactions where user is tagged (#p) - for notifications
          // 2. Outbox: Interactions authored by user - for cross-device sync
          const interactionBreakpoint =
          loadBackfillBreakpoint(`interactions_${keys.pkHex}`) || 0;
          
          const interactionFilters = [
            {
              kinds: [8965],
              "#p": [keys.pkHex], // Inbox: interactions targeted at us
              since: interactionBreakpoint + 1 // ⭐ inbox
            },
            {
              kinds: [8965],
              authors: [keys.pkHex], // Outbox: our own interactions
              since: interactionBreakpoint + 1 // ⭐ outbox
            }
          ];
          
          interactionsSub = subscribe(relays, interactionFilters);
          
          interactionsSub.on("event", async (evt: any) => {
           // ① 只处理互动事件
           if (evt.kind !== 8965) return;

           // ② 确保 key 已就绪（PWA 这里很关键）
           if (!keys.pkHex) {
           logger.warn("[互动事件] 收到但 pkHex 未就绪，跳过", evt.id);
           return;
           }

           // ③ 打点日志（现在你最需要的是“确定有没有进来”）
           logger.info(
             "[互动事件] Home.vue 收到",
             evt.id.slice(0, 8),
             "from",
             evt.pubkey.slice(0, 8)
           );

           // ④ 真正交给 interactions 处理
           await interactions.processInteractionEvent(evt, keys.pkHex);
         });

          logger.debug("已订阅互动事件 (收件箱+发件箱)");
        } catch (e) {
          logger.warn("subscribe to interactions failed", e);
        }
      } catch (e) {
        logger.error("startSub failed", e);
        status.value = "订阅失败";
      }
    }

    onMounted(() => { 
      startSub().catch(console.error); 
      handleNotificationJump();
      
      // Set up IntersectionObserver for bottom sentinel
      // Use nextTick to ensure DOM is fully rendered
      nextTick(() => {
        const bottomSentinel = bottomSentinelRef.value;
        if (bottomSentinel) {
          bottomObserver.value = new IntersectionObserver(
            (entries) => {
              // IntersectionObserver guarantees at least one entry for the observed element
              atBottom.value = entries[0].isIntersecting;
            },
            {
              root: null, // viewport
              rootMargin: '100px', // Trigger 100px before bottom edge is reached for better UX
              threshold: 0 // Trigger as soon as sentinel enters the extended area
            }
          );
          bottomObserver.value.observe(bottomSentinel);
        }
      });
    });

   watch(
     () => interactions.interactions,
     () => {
       if (notificationJumpDone.value) return;
       handleNotificationJump();
     },
     { deep: true }
   );

   watch(readyForPending, (v) => {
      if (v) {
        updateLocalRefs();
      }
   });
   
   
    // Watch for changes to msgs.inbox to handle optimistic UI updates
    // This ensures own messages added via PostEditorModal appear immediately
    // Using 'post' flush to batch updates and run after component updates
    watch(() => msgs.inbox.length, (newLength, oldLength) => {
      // Only update if not during initial load and if messages were added (not removed)
      if (!isInitialLoad.value && newLength > oldLength) {
        updateLocalRefs();
      }
    }, { flush: 'post' });

    onBeforeUnmount(() => {
      // Clean up IntersectionObserver
      if (bottomObserver.value) {
        bottomObserver.value.disconnect();
        bottomObserver.value = null;
      }
      
      // Clean up subscriptions
      if (sub) {
        try { if (typeof sub.close === "function") sub.close(); else if (typeof sub.unsub === "function") sub.unsub(); else if (typeof sub.unsubscribe === "function") sub.unsubscribe(); else if (typeof sub === "function") sub(); } catch {}
      }
      if (interactionsSub) {
        try { if (typeof interactionsSub.close === "function") interactionsSub.close(); else if (typeof interactionsSub.unsub === "function") interactionsSub.unsub(); else if (typeof interactionsSub.unsubscribe === "function") interactionsSub.unsubscribe(); else if (typeof interactionsSub === "function") interactionsSub(); } catch {}
      }
    });

    return { 
      displayedMessages,
      pendingMessages,
      toLocalTime, 
      shortPub, 
      status, 
      shortRelay, 
      displayName, 
      textWithoutImages,
      // Like and comment functions
      toggleLike,
      isLiked,
      getLikeCount,
      toggleComments,
      toggleSendMeta,
      addComment,
      getComments,
      getCommentCount,
      showingComments,
      showingSendMeta,
      commentInputs,
      // Reply functions
      startReply,
      cancelReply,
      getReplies,
      replyingTo,
      replyingToAuthor,
      messageTimeRange,
      showPendingMessages,
      showOlderLocalMessages,
      showOlderLocal,
      hasOlderLocalMessages,
      atBottom,
      bottomSentinelRef,
      container,
      pullDistance,
      refreshing

      
    };
  }
});
</script>

<style scoped>
.home-container {
  position: relative;
  min-height: 100vh;
  overscroll-behavior: contain;
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
  position: fixed;
  top: 20px;
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
  animation: slideDown 0.3s ease;
  transition: all 0.2s;
}

.new-messages-notification:hover {
  transform: translateX(-50%) translateY(2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
}

.new-messages-notification:active {
  transform: translateX(-50%) scale(0.95);
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
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  /* Prevent iOS zoom on focus */
  font-size: 16px;
  box-sizing: border-box;
  max-width: 100%;
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

.show-older-container {
  display: flex;
  justify-content: center;
  margin: 12px 0;
}

.show-older-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  border: 1px solid #cbd5e1;
  padding: 10px 20px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: #475569;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.show-older-btn:hover {
  background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.show-older-btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.show-older-icon {
  font-size: 16px;
}

.show-older-text {
  font-size: 14px;
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

.bottom-sentinel {
  height: 1px;
  visibility: hidden;
}

</style>
