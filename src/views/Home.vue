<template>
  <PullToRefresh @refresh="handleRefresh">
    <div>
      <div class="card">
      
        
        <div class="small" style="margin-top:6px;">订阅状态: {{ status }}</div>
        <div v-if="messageTimeRange" class="small" style="margin-top:4px; color: #94a3b8;">
          仅展示三天内的新消息: {{ messageTimeRange }}
        </div>
      </div>

    <div class="card">
      <!-- New message notification banner -->
      <div v-if="newMessageCount > 0" class="new-message-banner" @click="showNewMessages">
        <span class="new-message-text">{{ newMessageCount }} 条新消息</span>
        <span class="new-message-icon">↓</span>
      </div>
      
      <h4 style="margin: 0 0 12px 0;">好友动态</h4>
      <div v-if="displayedMessages.length === 0" class="small">还没有消息</div>
      <RecycleScroller
        v-if="displayedMessages.length > 0"
        class="scroller"
        :items="displayedMessages"
        :item-size="null"
        key-field="id"
        :buffer="200"
      >
        <template #default="{ item: m }">
          <div class="message-card">
            <div class="small">
              {{ displayName(m.pubkey) }}
              <span class="muted"> · {{ toLocalTime(m.created_at) }}</span>
            </div>

            <!-- 图片预览（方案 B：直接从内容抽取图片 URL 并渲染） -->
            <PostImagePreview :content="m.content" :showAll="false" style="margin-top:8px;" />

          <!-- 如果仍需显示文本（去除了图片 URL/Markdown），使用 processedTexts -->
          <div v-if="processedTexts[m.id]" class="message-text">{{ processedTexts[m.id] }}</div>
          
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
          </div>

            <!-- 评论区域 -->
            <div v-if="showingComments.has(m.id)" class="comments-section">
              <div class="comments-list">
                <div v-for="comment in getComments(m.id)" :key="comment.id" class="comment-thread">
                  <!-- 主评论 -->
                  <div class="comment-item">
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
        </template>
      </RecycleScroller>
    </div>
    </div>
  </PullToRefresh>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount, watch, computed } from "vue";
import { useFriendsStore } from "@/stores/friends";
import { useKeyStore } from "@/stores/keys";
import { getRelaysFromStorage, subscribe, onRelayReconnect, offRelayReconnect } from "@/nostr/relays";
import { symDecryptPackage } from "@/nostr/crypto";
import { useMessagesStore } from "@/stores/messages";
import { useInteractionsStore } from "@/stores/interactions";
import { logger } from "@/utils/logger";
import { formatRelativeTime } from "@/utils/format";
import PostImagePreview from "@/components/PostImagePreview.vue";
import BunkerStatus from "@/components/BunkerStatus.vue";
import PullToRefresh from "@/components/PullToRefresh.vue";
import { backfillEvents, saveBackfillBreakpoint, loadBackfillBreakpoint } from "@/utils/backfill";
import { isBunkerError } from "@/utils/bunker";
import { runWhenIdle } from "@/utils/idle";
import { RecycleScroller } from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";

// reuse the regex logic from extractImageUrls to strip out image markdown and plain image URLs
const mdImageRE = /!\[[^\]]*?\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
const plainImgUrlRE = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s)]*)?)/gi;

// Constants for time calculations
const SECONDS_PER_DAY = 24 * 60 * 60;
const THREE_DAYS_IN_SECONDS = 3 * SECONDS_PER_DAY;
const RECONNECT_BACKFILL_DEBOUNCE_MS = 2000; // Wait 2 seconds for multiple relays to reconnect

export default defineComponent({
  name: "Home",
  components: { PostImagePreview, BunkerStatus, RecycleScroller },
  setup() {
    const friends = useFriendsStore();
    const keys = useKeyStore();
    const msgs = useMessagesStore();
    const interactions = useInteractionsStore();

    const status = ref("未连接");
    let sub: any = null;
    let interactionsSub: any = null;

    const messagesRef = ref([] as any[]);
    const displayedMessages = ref([] as any[]);
    const newMessageCount = ref(0);
    const initialLoadComplete = ref(false);
    let autoRefreshTimer: number | null = null;
    
    // State for comments UI
    const showingComments = ref<Set<string>>(new Set());
    const commentInputs = ref<Record<string, string>>({});
    const replyingTo = ref<Record<string, string>>({}); // messageId -> commentId being replied to
    const replyingToAuthor = ref<Record<string, string>>({}); // messageId -> author pubkey of comment being replied to
    
    // State for message time range display
    const messageTimeRange = ref<string>("");
    
    function showNewMessages() {
      // Move all messages to displayed messages, sorted by timestamp
      displayedMessages.value = [...messagesRef.value];
      newMessageCount.value = 0;
    }

    function updateLocalRefs() {
      // Sort messages by timestamp descending (newest first)
      messagesRef.value = [...msgs.inbox].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      
      if (!initialLoadComplete.value) {
        // Initial load - show all messages sorted
        displayedMessages.value = [...messagesRef.value];
        initialLoadComplete.value = true;
      } else {
        // After initial load - check for new messages
        const currentDisplayedIds = new Set(displayedMessages.value.map(m => m.id));
        const newMessages = messagesRef.value.filter(m => !currentDisplayedIds.has(m.id));
        
        if (newMessages.length > 0) {
          // Check if any new messages are from the user themselves
          const ownMessages = newMessages.filter(m => m.pubkey === keys.pkHex);
          
          if (ownMessages.length > 0) {
            // Immediately show own posts
            displayedMessages.value = [...messagesRef.value];
            newMessageCount.value = 0;
            updateMessageTimeRange();
            
            // Clear any existing timer since we're immediately displaying
            if (autoRefreshTimer) {
              clearTimeout(autoRefreshTimer);
              autoRefreshTimer = null;
            }
          } else {
            // For messages from others, show new message count and auto-refresh after delay
            newMessageCount.value = newMessages.length;
            
            // Clear any existing timer
            if (autoRefreshTimer) {
              clearTimeout(autoRefreshTimer);
            }
            
            // Auto-refresh after 2 seconds
            autoRefreshTimer = window.setTimeout(() => {
              displayedMessages.value = [...messagesRef.value];
              newMessageCount.value = 0;
              updateMessageTimeRange();
            }, 2000);
          }
        }
      }
      
      updateMessageTimeRange();
    }
    
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
      if (msgs.inbox.find((m) => m.id === evt.id)) return false;
      const added = { id: evt.id, pubkey: evt.pubkey, created_at: evt.created_at, content: plain };
      msgs.addInbox(added);
      updateLocalRefs();
      return true;
    }

    function textWithoutImages(content: string): string {
      if (!content) return "";
      // remove markdown image ![alt](url)
      let s = content.replace(mdImageRE, "");
      // remove plain image urls
      s = s.replace(plainImgUrlRE, "");
      // collapse multiple blank lines and trim
      s = s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return s;
    }

    // Cache processed text for all displayed messages to avoid repeated regex operations
    const processedTexts = computed(() => {
      const cache: Record<string, string> = {};
      for (const msg of displayedMessages.value) {
        if (msg && msg.id && msg.content) {
          cache[msg.id] = textWithoutImages(msg.content);
        }
      }
      return cache;
    });

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

    // Comment functionality
    function toggleComments(messageId: string) {
      if (showingComments.value.has(messageId)) {
        showingComments.value.delete(messageId);
      } else {
        showingComments.value.add(messageId);
      }
      // Trigger reactivity
      showingComments.value = new Set(showingComments.value);
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
        
        // Determine time range for backfill - always use 3-day window
        let since: number;
        let until: number = now;
        
        // Get the newest message timestamp from the already sorted messagesRef
        // (messagesRef is sorted descending in updateLocalRefs, so first element is newest)
        let lastMessageTime = 0;
        if (messagesRef.value.length > 0) {
          lastMessageTime = messagesRef.value[0]?.created_at || 0;
        }
        
        // Check if we have messages and if the last message is within 3 days
        const threeDaysAgo = now - THREE_DAYS_IN_SECONDS;
        
        if (lastMessageTime > 0 && lastMessageTime >= threeDaysAgo) {
          // Have messages within 3 days - fetch messages newer than last message, within 3 days
          // Use lastMessageTime directly as relay will return messages with created_at >= since
          since = lastMessageTime;
          logger.info(`有三天内的消息，拉取晚于最后一条消息的三天内信息: ${new Date(since * 1000).toLocaleString()}`);
        } else {
          // No messages or last message is older than 3 days - fetch last 3 days
          since = threeDaysAgo;
          logger.info(`无三天内消息，拉取最近三天的事件: ${new Date(since * 1000).toLocaleString()}`);
        }
        
        status.value = "获取历史消息中...";
        
        // Track decryption statistics
        let fetchedEvents = 0;
        let decryptedEvents = 0;
        let notForMe = 0;
        let parseErrors = 0;
        let decryptErrors = 0;
        let bunkerErrors = 0;
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
            } catch (e: any) {
              // Check if this is a bunker-related error
              if (isBunkerError(e)) {
                bunkerErrors++;
                logger.warn(`事件 ${evt.id?.slice(0,8)} Bunker解密失败: ${e.message || e}`);
              } else {
                logger.warn(`事件 ${evt.id?.slice(0,8)} NIP-04解密失败，尝试备用方案`, e);
              }
              
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
            if (bunkerErrors > 0) summary.push(`签名器错误: ${bunkerErrors} 条`);
            if (decryptErrors > 0) summary.push(`其他解密失败: ${decryptErrors} 条`);
            
            const summaryText = summary.join(', ');
            logger.info(`回填完成: ${summaryText}`);
            
            if (decryptedEvents > 0) {
              status.value = `获取成功 ${decryptedEvents} 条消息`;
            } else if (fetchedEvents > 0) {
              // Provide more specific error message based on error type
              if (bunkerErrors > 0) {
                status.value = `获取了 ${fetchedEvents} 条事件，${bunkerErrors} 条因签名器问题无法解密`;
                logger.warn(`Bunker签名器连接问题导致解密失败。请检查签名器是否在线或尝试重新连接。`);
              } else {
                status.value = `获取了 ${fetchedEvents} 条事件但无法解密`;
                logger.warn(`回填获取了事件但全部解密失败。可能原因: 1) 事件不是发给自己的 2) 密钥不匹配 3) 数据格式错误`);
              }
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
    
    async function backfillInteractions(relays: string[], isReconnect = false) {
      try {
        const now = Math.floor(Date.now() / 1000);
        // Always use 3-day window for backfill (259200 seconds = 3 * 24 * 60 * 60)
        // This ensures consistency across devices and handles offline periods
        const since = now - THREE_DAYS_IN_SECONDS;
        const until = now;
        
        logger.info(`回填互动事件: 获取最近3天的互动 (${new Date(since * 1000).toLocaleString()} 到 ${new Date(until * 1000).toLocaleString()})`);
        
        // Track statistics
        let fetchedEvents = 0;
        let processedEvents = 0;
        
        // Process interaction event
        const processEvent = async (evt: any) => {
          fetchedEvents++;
          try {
            await interactions.processInteractionEvent(evt, keys.pkHex);
            processedEvents++;
          } catch (e) {
            logger.warn("处理回填互动事件失败", e);
          }
        };
        
        // Backfill interactions targeted at us
        await backfillEvents({
          relays,
          filters: {
            kinds: [24243],
            "#p": [keys.pkHex], // Interactions where we are recipient
            since,
            until
          },
          onEvent: processEvent,
          onProgress: (stats) => {
            logger.debug(`回填互动中: ${stats.totalEvents} 条事件`);
          },
          onComplete: (stats) => {
            logger.info(`互动事件(接收)回填完成: 获取 ${stats.totalEvents} 条`);
          },
          batchSize: 500,
          maxBatches: 10,
          timeoutMs: 10000
        });
        
        // Backfill interactions authored by us (for cross-device sync)
        await backfillEvents({
          relays,
          filters: {
            kinds: [24243],
            authors: [keys.pkHex], // Interactions we authored
            since,
            until
          },
          onEvent: processEvent,
          onProgress: (stats) => {
            logger.debug(`回填自己的互动中: ${stats.totalEvents} 条事件`);
          },
          onComplete: (stats) => {
            logger.info(`互动事件(发送)回填完成: 获取 ${stats.totalEvents} 条`);
          },
          batchSize: 500,
          maxBatches: 10,
          timeoutMs: 10000
        });
        
        logger.info(`互动事件回填完成: 总共获取 ${fetchedEvents} 条, 处理 ${processedEvents} 条`);
        
      } catch (e) {
        logger.error("回填互动事件失败", e);
      }
    }

    async function startSub() {
      try {
        logger.info("开始订阅流程");
        
        // Show loading status immediately
        status.value = "加载中...";
        
        // Load data in background without blocking render
        runWhenIdle(() => {
          friends.load().then(() => {
            logger.info(`好友列表加载完成: ${friends.list.length} 个好友`);
            
            if (!keys.isLoggedIn) {
              status.value = "未登录";
              return;
            }
            
            // Continue loading other data in background
            Promise.all([
              msgs.load(),
              interactions.load()
            ]).then(() => {
              updateLocalRefs();
              // Start subscription after data is loaded
              startSubscription();
            }).catch((e) => {
              logger.error("加载数据失败", e);
              status.value = "加载失败";
            });
          }).catch((e) => {
            logger.error("加载好友列表失败", e);
            status.value = "加载失败";
          });
        });
      } catch (e) {
        logger.error("startSub failed", e);
        status.value = "订阅失败";
      }
    }

    async function startSubscription() {
      try {
        if (!keys.isLoggedIn) {
          status.value = "未登录";
          return;
        }

        const friendSet = new Set<string>((friends.list || []).map((f: any) => f.pubkey));
        if (keys.pkHex) friendSet.add(keys.pkHex);
        logger.info(`准备订阅 ${friendSet.size} 个作者（包括自己）`);
        
        if (friendSet.size === 0) {
          status.value = "好友为空";
          return;
        }

        const relays = getRelaysFromStorage();
        
        // Start backfill in background (don't await) - let cached content display first
        backfillMessages(friendSet, relays).catch((e) => {
          logger.error("Failed to backfill historical messages from relays", e);
        });

        const filters = { kinds: [8964], authors: Array.from(friendSet) };
        status.value = "连接中";

        try {
          if (sub) {
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
              } catch (e: any) {
                // Check if this is a bunker-related error
                if (isBunkerError(e)) {
                  logger.warn(`实时事件 ${evt.id?.slice(0,8)} Bunker解密失败: ${e.message || e}. 请检查签名器连接。`);
                } else {
                  logger.warn(`实时事件 ${evt.id?.slice(0,8)} NIP-04解密失败，尝试备用方案`, e);
                }
                
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
        
        // Backfill historical interactions in background (don't await)
        backfillInteractions(relays).catch((e) => {
          logger.error("Failed to backfill historical interactions from relays", e);
        });
        
        // Subscribe to interactions (kind 24243)
        // We need two filters to catch all relevant interactions:
        // 1. Interactions targeted at us (we are recipient)
        // 2. Interactions from us (we are author) - to sync across devices
        try {
          const interactionsFilters = [
            {
              kinds: [24243],
              "#p": [keys.pkHex] // Interactions where we are tagged as recipient
            },
            {
              kinds: [24243],
              authors: [keys.pkHex] // Interactions we authored (to sync between devices)
            }
          ];
          
          interactionsSub = subscribe(relays, interactionsFilters);
          
          interactionsSub.on("event", async (evt: any) => {
            await interactions.processInteractionEvent(evt, keys.pkHex);
          });
          
          logger.debug("已订阅互动事件");
        } catch (e) {
          logger.warn("subscribe to interactions failed", e);
        }
      } catch (e) {
        logger.error("startSub failed", e);
        status.value = "订阅失败";
      }
    }

    // Watch for changes in msgs.inbox length to update display when posts are added
    // Using length instead of deep watch for better performance
    watch(() => msgs.inbox.length, () => {
      updateLocalRefs();
    });

    // Handle online/offline events for interaction backfill
    function handleOnline() {
      logger.info("网络已恢复，开始回填错过的互动事件");
      const relays = getRelaysFromStorage();
      // Trigger backfill with reconnect flag
      backfillInteractions(relays, true).catch((e) => {
        logger.error("重新连接后回填互动事件失败", e);
      });
    }
    
    // Handle relay reconnections
    let reconnectBackfillTimer: number | null = null;
    function handleRelayReconnect(url: string) {
      logger.info(`中继重连: ${url}，将回填错过的互动事件`);
      
      // Debounce: wait for multiple relays to reconnect before triggering backfill
      if (reconnectBackfillTimer) {
        clearTimeout(reconnectBackfillTimer);
      }
      
      reconnectBackfillTimer = window.setTimeout(() => {
        const relays = getRelaysFromStorage();
        backfillInteractions(relays, true).catch((e) => {
          logger.error("中继重连后回填互动事件失败", e);
        });
      }, RECONNECT_BACKFILL_DEBOUNCE_MS);
    }
    
    async function handleRefresh(finishRefresh: () => void) {
      try {
        logger.info("用户触发下拉刷新");
        status.value = "刷新中...";
        
        // Re-fetch messages and interactions
        await friends.load();
        const friendSet = new Set<string>((friends.list || []).map((f: any) => f.pubkey));
        if (keys.pkHex) friendSet.add(keys.pkHex);
        
        const relays = getRelaysFromStorage();
        
        // Backfill latest messages
        await backfillMessages(friendSet, relays);
        
        // Backfill latest interactions
        await backfillInteractions(relays, true);
        
        logger.info("下拉刷新完成");
        // Restore subscription status after refresh
        if (status.value === "刷新中...") {
          status.value = "已订阅";
        }
      } catch (e) {
        logger.error("下拉刷新失败", e);
        status.value = "刷新失败";
      } finally {
        finishRefresh();
      }
    }

    onMounted(async () => { 
      await startSub();
      
      // Listen for online event to backfill missed interactions
      window.addEventListener('online', handleOnline);
      
      // Listen for relay reconnections
      onRelayReconnect(handleRelayReconnect);
    });

    onBeforeUnmount(() => {
      // Clean up auto-refresh timer
      if (autoRefreshTimer) {
        clearTimeout(autoRefreshTimer);
        autoRefreshTimer = null;
      }
      
      // Clean up reconnect backfill timer
      if (reconnectBackfillTimer) {
        clearTimeout(reconnectBackfillTimer);
        reconnectBackfillTimer = null;
      }
      
      // Clean up online event listener
      window.removeEventListener('online', handleOnline);
      
      // Clean up relay reconnect listener
      offRelayReconnect(handleRelayReconnect);
      
      if (sub) {
        try { if (typeof sub.close === "function") sub.close(); else if (typeof sub.unsub === "function") sub.unsub(); else if (typeof sub.unsubscribe === "function") sub.unsubscribe(); else if (typeof sub === "function") sub(); } catch {}
      }
      if (interactionsSub) {
        try { if (typeof interactionsSub.close === "function") interactionsSub.close(); else if (typeof interactionsSub.unsub === "function") interactionsSub.unsub(); else if (typeof interactionsSub.unsubscribe === "function") interactionsSub.unsubscribe(); else if (typeof interactionsSub === "function") interactionsSub(); } catch {}
      }
    });

    return { 
      displayedMessages,
      newMessageCount,
      showNewMessages,
      toLocalTime, 
      shortPub, 
      status, 
      shortRelay, 
      displayName, 
      textWithoutImages,
      processedTexts,
      // Like and comment functions
      toggleLike,
      isLiked,
      getLikeCount,
      toggleComments,
      addComment,
      getComments,
      getCommentCount,
      showingComments,
      commentInputs,
      // Reply functions
      startReply,
      cancelReply,
      getReplies,
      replyingTo,
      replyingToAuthor,
      messageTimeRange
    };
  }
});
</script>

<style scoped>
.small { font-size:12px; color:#64748b; }
.card { background: #fff; padding:12px; border-radius:10px; margin-bottom:12px; box-shadow: 0 4px 10px rgba(0,0,0,0.04); }
.list { display:flex; flex-direction:column; gap:8px; }
.muted { color: #94a3b8; font-size: 12px; margin-left:6px; }

/* Virtual scroller styles */
.scroller {
  /* Height calculation: 100vh minus header, card padding, and margins (~220px) */
  height: calc(100vh - 220px);
  min-height: 400px;
}

.message-card {
  background: #fff;
  padding: 12px;
  border-radius: 10px;
  margin-bottom: 8px;
  box-shadow: 0 4px 10px rgba(0,0,0,0.04);
}
.message-text {
  margin-top: 8px;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.new-message-banner {
  background: linear-gradient(135deg, #e0f2fe 0%, #dbeafe 100%);
  color: #1976d2;
  padding: 8px 16px;
  border-radius: 8px;
  margin-bottom: 12px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(25, 118, 210, 0.1);
}

.new-message-banner:hover {
  background: linear-gradient(135deg, #bae6fd 0%, #bfdbfe 100%);
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(25, 118, 210, 0.15);
}

.new-message-text {
  flex: 1;
}

.new-message-icon {
  font-size: 16px;
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-3px);
  }
}

.message-actions {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  padding-top: 8px;
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
}</style>
