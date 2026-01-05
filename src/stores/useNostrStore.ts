import { defineStore } from "pinia";
import { ref } from "vue";
import { NostrService } from "@/utils/nostr";
import { getDatabase, type DBMessage } from "@/db/dexie";
import { useKeyStore } from "@/stores/keys";
import { logger } from "@/utils/logger";

const nostr = new NostrService();

export type Message = DBMessage;

export const useNostrStore = defineStore("nostr", () => {
  const messages = ref<Message[]>([]);
  const loadedFor = ref<string>("");

  let db: ReturnType<typeof getDatabase> | null = null;

  /* ================================================================
   * reset — 切账号 / logout
   * ================================================================ */
  function reset() {
    messages.value = [];
    loadedFor.value = "";
    db = null;
  }

  /* ================================================================
   * load — 按 pk 加载 Dexie
   * ================================================================ */
  async function load(pk?: string) {
    const ks = useKeyStore();
    const targetPk = pk ?? ks.pkHex;

    if (!targetPk) {
      reset();
      return;
    }

    // 🔥 切账号
    if (loadedFor.value && loadedFor.value !== targetPk) {
      reset();
    }

    if (loadedFor.value === targetPk) return;

    loadedFor.value = targetPk;
    db = getDatabase(targetPk);

    try {
      messages.value = await db.messages
        .orderBy("created_at")
        .reverse()
        .toArray();
    } catch (e) {
      logger.error("load cached messages failed", e);
    }
  }

  /* ================================================================
   * connect
   * ================================================================ */
  function connect() {
    nostr.connect();
  }

  /* ================================================================
   * subscribe
   * ================================================================ */
  function subscribeByAuthors(authors: string[]) {
    const ks = useKeyStore();
    if (!ks.pkHex || ks.pkHex !== loadedFor.value || !db) {
      logger.warn("subscribe aborted: not loaded for current pk");
      return;
    }

    nostr.subscribe({
      authors,
      onEvent: async (evt: any) => {
        // 🔒 防串号
        if (ks.pkHex !== loadedFor.value || !db) return;

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
          logger.warn("save message failed", e);
        }
      }
    });
  }

  /* ================================================================
   * publish
   * ================================================================ */
  async function publishMultiRecipient(opts: {
    content: string;
    privateKey: string;
    recipients: string[];
  }) {
    await nostr.publishMultiRecipient({
      ...opts,
      kind: 8964
    });
  }

  return {
    messages,
    load,
    reset,
    connect,
    subscribeByAuthors,
    publishMultiRecipient
  };
});