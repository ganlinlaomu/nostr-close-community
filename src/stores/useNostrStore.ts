import { defineStore } from 'pinia';
import { ref, onMounted } from 'vue';
import { NostrService } from '../utils/nostr';
import { getCurrentDatabase } from '../db/dexie';
import { useKeyStore } from './keys';
import { useFriendsStore } from './friends';
import { logger } from '../utils/logger';

export type Message = {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
};

const nostr = new NostrService();

export default defineStore('nostr', () => {
  const messages = ref<Message[]>([]);

  // Dexie db 实例
  let db;
  try {
    db = getCurrentDatabase();
  } catch (e) {
    logger.warn('[nostr] db not ready yet', e);
  }

  /* ------------------------------------------------------------------
   * Load cached messages
   * ------------------------------------------------------------------ */
  const loadCached = async () => {
    if (!db) {
      try {
        db = getCurrentDatabase();
      } catch (e) {
        logger.warn('[nostr] load aborted: db not ready', e);
        return;
      }
    }

    try {
      messages.value = await db.messages.orderBy('created_at').reverse().toArray();
      logger.info(`[nostr] loaded cached messages: ${messages.value.length}`);
    } catch (e) {
      logger.error('[nostr] load cached messages failed', e);
    }
  };

  /* ------------------------------------------------------------------
   * Subscribe to self + friends' messages (kind 8964)
   * ------------------------------------------------------------------ */
  const autoSubscribe = () => {
    const ks = useKeyStore();
    const friendsStore = useFriendsStore();

    if (!ks.pkHex) {
      logger.warn('[nostr] autoSubscribe aborted: not logged in');
      return;
    }

    if (!db) {
      try {
        db = getCurrentDatabase();
      } catch (e) {
        logger.warn('[nostr] autoSubscribe aborted: db not ready', e);
        return;
      }
    }

    // 获取好友列表 pk
    const friendPks = friendsStore.friends.map(f => f.pubkey);
    const authors = [ks.pkHex, ...friendPks];

    nostr.subscribe({
      authors,
      kinds: [8964], // 只订阅 kind 8964
      onEvent: async (evt: any) => {
        // 防 logout 串写
        if (!useKeyStore().pkHex) return;

        const msg: Message = {
          id: evt.id,
          pubkey: evt.pubkey,
          content: evt.content,
          created_at: evt.created_at
        };
        messages.value.unshift(msg);

        try {
          await db.messages.put(msg);
        } catch (e) {
          logger.warn('[nostr] save message failed', e);
        }
      }
    });
  };

  const connect = () => nostr.connect();

  /* ------------------------------------------------------------------
   * Subscribe to specific authors
   * ------------------------------------------------------------------ */
  const subscribeByAuthors = (authors: string[]) => {
    if (!db) {
      try {
        db = getCurrentDatabase();
      } catch (e) {
        logger.warn('[nostr] subscribe aborted: db not ready', e);
        return;
      }
    }

    nostr.subscribe({
      authors,
      kinds: [8964], // 只订阅 kind 8964
      onEvent: async (evt: any) => {
        const msg: Message = {
          id: evt.id,
          pubkey: evt.pubkey,
          content: evt.content,
          created_at: evt.created_at
        };
        messages.value.unshift(msg);

        try {
          await db.messages.put(msg);
        } catch (e) {
          logger.warn('[nostr] save message failed', e);
        }
      }
    });
  };

  /* ------------------------------------------------------------------
   * Publish messages
   * ------------------------------------------------------------------ */
  const publishMultiRecipient = async (opts: { content: string; privateKey: string; recipients: string[] }) => {
    const { content, privateKey, recipients } = opts;
    await nostr.publishMultiRecipient({
      content,
      privateKey,
      recipients,
      kind: 8964
    });
  };

  // 自动加载缓存 + 自动订阅
  onMounted(() => {
    loadCached();
    autoSubscribe();
  });

  return {
    messages,
    connect,
    subscribeByAuthors,
    publishMultiRecipient,
    loadCached,
    autoSubscribe
  };
});