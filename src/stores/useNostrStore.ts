import { defineStore } from 'pinia';
import { ref } from 'vue';
import { NostrService } from '../utils/nostr';
import { getCurrentDatabase } from '../db/dexie';
import { useKeyStore } from './keys';
import { useFriendsStore } from './friends';
import { useMessagesStore } from './messages'; // ✅ 引入消息存储
import { logger } from '../utils/logger';

const nostr = new NostrService();

export default defineStore('nostr', () => {
  const messagesStore = useMessagesStore();
  
  // ✅ 移除顶层的 let db; 改为在需要时调用 getCurrentDatabase()

  /**
   * 自动订阅：建议由 keys.ts 的 afterLogin 手动触发
   * 而不是依赖 onMounted
   */
  const autoSubscribe = () => {
    const ks = useKeyStore();
    const friendsStore = useFriendsStore();

    if (!ks.pkHex) {
      logger.warn('[nostr] autoSubscribe aborted: not logged in');
      return;
    }

    // 获取好友列表 pk
    const friendPks = friendsStore.list.map(f => f.pubkey); // 修正为 list
    const authors = [ks.pkHex, ...friendPks];

    nostr.subscribe({
      authors,
      kinds: [8964],
      onEvent: async (evt: any) => {
        // 1. 安全检查
        if (!ks.pkHex) return;

        // 2. 格式化
        const msg = {
          id: evt.id,
          pubkey: evt.pubkey,
          content: evt.content,
          created_at: evt.created_at
        };

        // 3. ✅ 统一交给 messagesStore 处理存储和内存更新
        // 这样就不需要在这里写 db.messages.put 了
        await messagesStore.addInbox(msg);
      }
    });
  };

  const connect = () => nostr.connect();

  /* ------------------------------------------------------------------
   * 发布消息
   * ------------------------------------------------------------------ */
  const publishMultiRecipient = async (opts: { content: string; privateKey: string; recipients: string[] }) => {
    const { content, privateKey, recipients } = opts;
    
    // 调用协议层发布
    const event = await nostr.publishMultiRecipient({
      content,
      privateKey,
      recipients,
      kind: 8964
    });

    // 如果发送成功，将其存入自己的发件箱
    if (event) {
      await messagesStore.addOutbox({
        id: event.id,
        created_at: event.created_at,
        sent_at: Math.floor(Date.now() / 1000),
        content: content,
        relayResults: [] // 实际开发中可以从 pool.publish 获取结果
      });
    }
  };

  // ✅ 移除内部的 loadCached，因为 messagesStore.load() 已经做了这件事

  return {
    connect,
    autoSubscribe,
    publishMultiRecipient
  };
});