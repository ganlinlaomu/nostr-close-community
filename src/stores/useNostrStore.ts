import { defineStore } from "pinia";
import { ref } from "vue";
import { NostrService } from "@/utils/nostr";
import { getCurrentDatabase, type DBMessage } from "@/db/dexie";
import { useKeyStore } from "@/stores/keys";
import { logger } from "@/utils/logger";

const nostr = new NostrService();

export type Message = DBMessage;

export const useNostrStore = defineStore("nostr", () => {
  /* ------------------------------------------------------------------
   * state
   * ------------------------------------------------------------------ */

  const messages = ref<Message[]>([]);

  /* ------------------------------------------------------------------
   * reset — logout / 切账号时由 keys.ts 统一触发
   * ------------------------------------------------------------------ */

  function reset() {
    messages.value = [];
  }

  /* ------------------------------------------------------------------
   * load — 从「当前已打开的 Dexie」加载
   * ❗ 不接收 pk
   * ❗ 不判断账号
   * ------------------------------------------------------------------ */

  async function load() {
    try {
      const db = getCurrentDatabase();

      messages.value = await db.messages
        .orderBy("created_at")
        .reverse()
        .toArray();
    } catch (e) {
      logger.error("[nostr] load cached messages failed", e);
    }
  }

  /* ------------------------------------------------------------------
   * connect
   * ------------------------------------------------------------------ */

  function connect() {
    nostr.connect();
  }

  /* ------------------------------------------------------------------
   * subscribe
   * ------------------------------------------------------------------ */

  function subscribeByAuthors(authors: string[]) {
    const ks = useKeyStore();

    if (!ks.pkHex) {
      logger.warn("[nostr] subscribe aborted: not logged in");
      return;
    }

    let db;
    try {
      db = getCurrentDatabase();
    } catch {
      logger.warn("[nostr] subscribe aborted: db not ready");
      return;
    }

    nostr.subscribe({
      authors,
      onEvent: async (evt: any) => {
        // 🔒 再次确认登录态（防 logout 后串写）
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
          logger.warn("[nostr] save message failed", e);
        }
      }
    });
  }

  /* ------------------------------------------------------------------
   * publish
   * ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------
   * expose
   * ------------------------------------------------------------------ */

  return {
    messages,
    load,
    reset,
    connect,
    subscribeByAuthors,
    publishMultiRecipient
  };
});