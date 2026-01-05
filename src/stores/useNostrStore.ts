import { defineStore } from 'pinia';
import { ref } from 'vue';
import { NostrService } from '../utils/nostr';
import { db } from '../db/dexie';

type Message = {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
};

const nostr = new NostrService();

export default defineStore('nostr', () => {
  const messages = ref<Message[]>([]);

  // Load cached messages from Dexie
  const loadCached = async () => {
    messages.value = await db.messages.orderBy('created_at').reverse().toArray();
  };

  loadCached();

  const connect = () => nostr.connect();

  const subscribeByAuthors = (authors: string[]) => {
    // subscribe with authors filter
    nostr.subscribe({
      authors,
      onEvent: async (evt: any) => {
        const msg: Message = {
          id: evt.id,
          pubkey: evt.pubkey,
          content: evt.content,
          created_at: evt.created_at
        };
        messages.value.unshift(msg);
        await db.messages.put(msg);
      }
    });
  };

  const publishMultiRecipient = async (opts: { content: string; privateKey: string; recipients: string[] }) => {
    const { content, privateKey, recipients } = opts;
    // publish via NostrService
    await nostr.publishMultiRecipient({
      content,
      privateKey,
      recipients,
      kind: 8964
    });
  };

  return {
    messages,
    connect,
    subscribeByAuthors,
    publishMultiRecipient
  };
});
