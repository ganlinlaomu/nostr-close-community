import { defineStore } from 'pinia';
import { useKeyStore } from './keys';
import { useFriendsStore } from './friends';
import { useMessagesStore, DBMessage } from './messages';
import { NostrService } from '../utils/nostr';
import { getCurrentDatabase } from '../db/dexie';
import { logger } from '../utils/logger';

const nostr = new NostrService();

export default defineStore('nostr', () => {
  const messagesStore = useMessagesStore();

  const autoSubscribe = () => {
    const ks = useKeyStore();
    const friendsStore = useFriendsStore();

    if (!ks.pkHex) {
      logger.warn('[nostr] autoSubscribe aborted: not logged in');
      return;
    }

    const friendPks = friendsStore.list.map(f => f.pubkey);
    const authors = [ks.pkHex, ...friendPks];

    nostr.subscribe({
      authors,
      kinds: [8964],
      onEvent: async (evt: any) => {
        if (!ks.pkHex) return;

        const msg: DBMessage = {
          id: evt.id,
          pubkey: evt.pubkey,
          content: evt.content,
          created_at: evt.created_at
        };

        try {
          // ✅ 直接寫入 Dexie 並更新內存
          await messagesStore.addInbox(msg);
        } catch (e) {
          logger.error("[usenostrstore] addInbox failed", e);
        }
      }
    });
  };

  const connect = () => nostr.connect();

  const publishMultiRecipient = async (opts: { content: string; privateKey: string; recipients: string[] }) => {
    const { content, privateKey, recipients } = opts;

    const event = await nostr.publishMultiRecipient({
      content,
      privateKey,
      recipients,
      kind: 8964
    });

    if (event) {
      // 發件箱可選存入 Dexie 或僅內存
      const outboxMsg: DBMessage = {
        id: event.id,
        pubkey: getCurrentDatabase ? event.pubkey : '', // 可以選擇記錄自己的pubkey
        content: content,
        created_at: event.created_at
      };
      await messagesStore.addInbox(outboxMsg); // 發送後也存入內存/DB
    }
  };

  return {
    connect,
    autoSubscribe,
    publishMultiRecipient
  };
});