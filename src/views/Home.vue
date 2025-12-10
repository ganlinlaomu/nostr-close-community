<template>
  <div>
    <div class="card">
      <h3>信息流（时间线）</h3>
      <div class="small">已自动订阅你添加的好友，实时解密可读消息</div>
      <div class="small" style="margin-top:6px;">订阅状态: {{ status }}</div>
      <div v-if="messageTimeRange" class="small muted" style="margin-top:4px;">
        消息时间范围: {{ messageTimeRange }}
      </div>
    </div>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h4 style="margin: 0;">消息</h4>
        <button 
          v-if="canLoadMore" 
          class="load-more-btn" 
          @click="loadMoreMessages"
          :disabled="isLoadingMore"
        >
          {{ isLoadingMore ? '加载中...' : '加载更早的消息' }}
        </button>
      </div>
      <div v-if="messages.length === 0" class="small">还没有消息</div>
      <div class="list">
        <div v-for="m in messages" :key="m.id" class="card">
          <div class="small">
            {{ displayName(m.pubkey) }}
            <span class="muted"> · {{ toLocalTime(m.created_at) }}</span>
          </div>

          <!-- 图片预览（方案 B：直接从内容抽取图片 URL 并渲染） -->
          <PostImagePreview :content="m.content" :showAll="false" style="margin-top:8px;" />

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
                    <button class="reply-btn small" @click="startReply(m.id, reply.id, displayName(reply.author))">
                      回复
                    </button>
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
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, onMounted, onBeforeUnmount } from "vue";
import { useFriendsStore } from "@/stores/friends";
import { useKeyStore } from "@/stores/keys";
import { getRelaysFromStorage, subscribe } from "@/nostr/relays";
import { symDecryptPackage } from "@/nostr/crypto";
import { useMessagesStore } from "@/stores/messages";
import { useInteractionsStore } from "@/stores/interactions";
import { logger } from "@/utils/logger";
import { formatRelativeTime } from "@/utils/format";
import PostImagePreview from "@/components/PostImagePreview.vue";
import { backfillEvents, saveBackfillBreakpoint, loadBackfillBreakpoint } from "@/utils/backfill";

// reuse the regex logic from extractImageUrls to strip out image markdown and plain image URLs
const mdImageRE = /!\[[^\]]*?\]\(\s*(https?:\/\/[^\s)]+)\s*\)/gi;
const plainImgUrlRE = /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s)]*)?)/gi;

// Constants for time calculations and pagination
const SECONDS_PER_DAY = 24 * 60 * 60;
const SEVEN_DAYS_IN_SECONDS = 7 * SECONDS_PER_DAY;
const THIRTY_DAYS_IN_SECONDS = 30 * SECONDS_PER_DAY;
const SIXTY_DAYS_IN_SECONDS = 60 * SECONDS_PER_DAY;
const MIN_MESSAGES_FOR_LOAD_MORE = 10;
const MAX_BATCHES_LOAD_MORE = 10;
const MAX_BATCHES_INITIAL = 20;

export default defineComponent({
  name: "Home",
  components: { PostImagePreview },
  setup() {
    const friends = useFriendsStore();
    const keys = useKeyStore();
    const msgs = useMessagesStore();
    const interactions = useInteractionsStore();

    const status = ref("未连接");
    let sub: any = null;
    let interactionsSub: any = null;

    const messagesRef = ref([] as any[]);
    
    // State for comments UI
    const showingComments = ref<Set<string>>(new Set());
    const commentInputs = ref<Record<string, string>>({});
    const replyingTo = ref<Record<string, string>>({}); // messageId -> commentId being replied to
    const replyingToAuthor = ref<Record<string, string>>({}); // messageId -> author pubkey of comment being replied to
    
    // State for pagination
    const canLoadMore = ref(false);
    const isLoadingMore = ref(false);
    const oldestLoadedTimestamp = ref<number>(0);
    const newestLoadedTimestamp = ref<number>(0);
    const messageTimeRange = ref<string>("");

    function updateLocalRefs() {
      messagesRef.value = msgs.inbox;
      updateMessageTimeRange();
    }
    
    function updateMessageTimeRange() {
      if (msgs.inbox.length === 0) {
        messageTimeRange.value = "";
        oldestLoadedTimestamp.value = 0;
        newestLoadedTimestamp.value = 0;
        return;
      }
      
      const oldest = msgs.inbox.reduce((min, msg) => {
        const ts = msg?.created_at || 0;
        return ts > 0 && (min === 0 || ts < min) ? ts : min;
      }, 0);
      
      const newest = msgs.inbox.reduce((max, msg) => {
        const ts = msg?.created_at || 0;
        return ts > max ? ts : max;
      }, 0);
      
      oldestLoadedTimestamp.value = oldest;
      newestLoadedTimestamp.value = newest;
      
      if (oldest > 0 && newest > 0) {
        const oldestDate = new Date(oldest * 1000);
        const newestDate = new Date(newest * 1000);
        messageTimeRange.value = `${oldestDate.toLocaleDateString('zh-CN')} - ${newestDate.toLocaleDateString('zh-CN')}`;
      }
      
      // Update canLoadMore based on whether we might have more history
      // If the oldest message is less than 60 days old and we have enough messages, suggest there might be more
      const now = Math.floor(Date.now() / 1000);
      const sixtyDaysAgo = now - SIXTY_DAYS_IN_SECONDS;
      // Only show load more if we have valid timestamps and meet the criteria
      canLoadMore.value = oldest > 0 && oldest > sixtyDaysAgo && msgs.inbox.length >= MIN_MESSAGES_FOR_LOAD_MORE;
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
    
    async function loadMoreMessages() {
      if (isLoadingMore.value || !canLoadMore.value) return;
      
      isLoadingMore.value = true;
      try {
        const friendSet = new Set<string>((friends.list || []).map((f: any) => f.pubkey));
        if (keys.pkHex) friendSet.add(keys.pkHex);
        
        if (friendSet.size === 0) {
          logger.warn("无法加载更多: 好友列表为空");
          return;
        }
        
        const relays = getRelaysFromStorage();
        await backfillMessages(friendSet, relays, true);
      } catch (e) {
        logger.error("加载更多消息失败", e);
        status.value = "加载失败";
      } finally {
        isLoadingMore.value = false;
      }
    }

    async function backfillMessages(friendSet: Set<string>, relays: string[], isLoadMore: boolean = false) {
      try {
        const now = Math.floor(Date.now() / 1000);
        
        // Determine time range for backfill
        let since: number;
        let until: number;
        
        if (isLoadMore) {
          // For "Load More", fetch older messages
          if (oldestLoadedTimestamp.value === 0) {
            logger.warn("无法加载更多: 没有最早消息时间戳");
            status.value = "无法加载更多消息";
            return;
          }
          until = oldestLoadedTimestamp.value - 1;
          // Fetch 30 days backward from oldest loaded message
          since = Math.max(until - THIRTY_DAYS_IN_SECONDS, 0);
          logger.info(`加载更多消息: ${new Date(since * 1000).toLocaleString()} 到 ${new Date(until * 1000).toLocaleString()}`);
        } else {
          // Normal initial backfill
          until = now;
          
          // Check for existing breakpoint
          const breakpointKey = `messages_${keys.pkHex}`;
          const savedBreakpoint = loadBackfillBreakpoint(breakpointKey);
          
          // Find the newest message timestamp from inbox
          let lastMessageTime = 0;
          if (msgs.inbox.length > 0) {
            lastMessageTime = msgs.inbox.reduce((max, msg) => {
              const timestamp = msg?.created_at || 0;
              return Math.max(max, timestamp);
            }, 0);
          }
          
          // Determine since time based on available information
          if (savedBreakpoint && savedBreakpoint > 0) {
            // Use saved breakpoint for incremental fetch
            since = savedBreakpoint;
            logger.info(`使用保存的断点: ${new Date(since * 1000).toLocaleString()}`);
          } else if (lastMessageTime > 0) {
            // Start from last message but limit to 7 days max
            since = Math.max(lastMessageTime, now - SEVEN_DAYS_IN_SECONDS);
            logger.info(`从最后消息时间开始: ${new Date(since * 1000).toLocaleString()}`);
          } else if (keys.loginTimestamp && keys.loginTimestamp > 0 && !isNaN(keys.loginTimestamp)) {
            // No messages and no breakpoint - this could be:
            // 1. First time login (loginTimestamp is close to now)
            // 2. Returning user with cleared cache (loginTimestamp is close to now but user has history)
            // In both cases, fetch last 30 days to ensure we get history for returning users
            since = Math.max(Math.floor(keys.loginTimestamp) - THIRTY_DAYS_IN_SECONDS, 0);
            logger.info(`完全无缓存，获取登录时间前30天的消息: ${new Date(since * 1000).toLocaleString()}`);
          } else {
            // Fallback: 30 days from now
            since = now - THIRTY_DAYS_IN_SECONDS;
            logger.info(`使用当前时间前30天: ${new Date(since * 1000).toLocaleString()}`);
          }
        }
        
        status.value = isLoadMore ? "加载更早的消息..." : "获取历史消息中...";
        
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
            kinds: [24242],
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
              status.value = isLoadMore 
                ? `加载了 ${decryptedEvents} 条历史消息`
                : `获取成功 ${decryptedEvents} 条消息`;
            } else if (fetchedEvents > 0) {
              status.value = `获取了 ${fetchedEvents} 条事件但无法解密`;
              logger.warn(`回填获取了事件但全部解密失败。可能原因: 1) 事件不是发给自己的 2) 密钥不匹配 3) 数据格式错误`);
            } else {
              status.value = isLoadMore ? "没有更早的消息" : "已是最新";
            }
            
            // Save breakpoint for next time
            // Use the newest message timestamp we received, or keep the old breakpoint
            if (!isLoadMore) {
              const breakpointKey = `messages_${keys.pkHex}`;
              if (newestTimestamp > 0) {
                // Save the timestamp of the newest message we received
                saveBackfillBreakpoint(breakpointKey, newestTimestamp);
                logger.info(`保存新断点: ${new Date(newestTimestamp * 1000).toLocaleString()}`);
              } else {
                // No new messages, save current time as breakpoint
                saveBackfillBreakpoint(breakpointKey, now);
              }
            }
          },
          batchSize: 1000, // Increased batch size for more efficient fetching
          authorBatchSize: 50,
          maxBatches: isLoadMore ? MAX_BATCHES_LOAD_MORE : MAX_BATCHES_INITIAL,
          timeoutMs: 10000
        });
        
      } catch (e) {
        logger.error("回填失败", e);
        status.value = "获取消息失败";
      }
    }

    async function startSub() {
      try {
        logger.info("开始订阅流程");
        await friends.load();
        logger.info(`好友列表加载完成: ${friends.list.length} 个好友`);
        
        if (!keys.isLoggedIn) {
          status.value = "未登录";
          return;
        }
        await msgs.load();
        await interactions.load(); // Load interactions
        updateLocalRefs();

        const friendSet = new Set<string>((friends.list || []).map((f: any) => f.pubkey));
        if (keys.pkHex) friendSet.add(keys.pkHex);
        logger.info(`准备订阅 ${friendSet.size} 个作者（包括自己）`);
        
        if (friendSet.size === 0) {
          status.value = "好友为空";
          return;
        }

        const relays = getRelaysFromStorage();
        
        // First, backfill historical messages
        await backfillMessages(friendSet, relays);

        const filters = { kinds: [24242], authors: Array.from(friendSet) };
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
        
        // Subscribe to interactions (kind 24243)
        try {
          const interactionsFilter = {
            kinds: [24243],
            "#p": [keys.pkHex] // Only get interactions targeted at us
          };
          
          interactionsSub = subscribe(relays, [interactionsFilter]);
          
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

    onMounted(async () => { 
      await startSub(); 
    });

    onBeforeUnmount(() => {
      if (sub) {
        try { if (typeof sub.close === "function") sub.close(); else if (typeof sub.unsub === "function") sub.unsub(); else if (typeof sub.unsubscribe === "function") sub.unsubscribe(); else if (typeof sub === "function") sub(); } catch {}
      }
      if (interactionsSub) {
        try { if (typeof interactionsSub.close === "function") interactionsSub.close(); else if (typeof interactionsSub.unsub === "function") interactionsSub.unsub(); else if (typeof interactionsSub.unsubscribe === "function") interactionsSub.unsubscribe(); else if (typeof interactionsSub === "function") interactionsSub(); } catch {}
      }
    });

    return { 
      messages: messagesRef, 
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
      // Pagination
      canLoadMore,
      isLoadingMore,
      loadMoreMessages,
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
.message-text {
  margin-top: 8px;
  white-space: pre-wrap;
  word-wrap: break-word;
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.load-more-btn {
  background: #f8fafc;
  color: #1976d2;
  border: 1px solid #e2e8f0;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  white-space: nowrap;
}

.load-more-btn:hover:not(:disabled) {
  background: #e0f2fe;
  border-color: #1976d2;
}

.load-more-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
