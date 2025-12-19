import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { genSymHex, symEncryptPackage } from "@/nostr/crypto";
import { logger } from "@/utils/logger";
import { useMessagesStore } from "@/stores/messages";

/**
 * posts store
 * - publishNip44PerMessage: store per-account outbox via messages store
 */
export const usePostsStore = defineStore("posts", {
  state: () => ({
    // keep a lightweight local outbox mirror if you want, but prefer messages store
  }),
  actions: {
    async publishNip44PerMessage(recipients: string[], plaintext: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");

      if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error("recipients 不能为空");
      }
      if (!recipients.includes(key.pkHex)) recipients = [...recipients, key.pkHex];

      const symHex = genSymHex();
      const pkg = await symEncryptPackage(symHex, plaintext);

      const keysArr: Array<{ to: string; enc: string }> = [];
      for (const r of recipients) {
        try {
          const enc = await key.nip04Encrypt(r, symHex);
          keysArr.push({ to: r, enc });
        } catch (e) {
          logger.warn("envelope encrypt failed for", r, e);
          keysArr.push({ to: r, enc: "" });
        }
      }

      const payload = { version: "nip-44-per-message-v1", keys: keysArr, pkg };
      const contentStr = JSON.stringify(payload);

      const event: any = {
        kind: 8964,
        pubkey: key.pkHex,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: contentStr
      };

      const signed = await key.signEvent(event);

      const relays = getRelaysFromStorage();

      let relayResults: Array<{ relay: string; ok: boolean; reason?: any; ts?: number }> = [];

      try {
        const pubs: any = await pool.publish(relays, signed);
        if (Array.isArray(pubs)) {
          relayResults = pubs.map((p: any) => ({ relay: p.relay || p.url, ok: !!p.ok, reason: p.reason, ts: p.ts || Date.now() }));
        } else {
          relayResults = relays.map((r) => ({ relay: r, ok: true, ts: Date.now() }));
        }
      } catch (e) {
        logger.warn("publish failed", e);
        relayResults = getRelaysFromStorage().map((r) => ({ relay: r, ok: false, reason: e, ts: Date.now() }));
      }

      const out = {
        id: signed.id,
        created_at: signed.created_at,
        sent_at: Date.now(),
        content: contentStr,
        relayResults
      };

      // persist into per-account outbox via messages store
      try {
        const msgs = useMessagesStore();
        // ensure loaded for current pk, then add
        await msgs.load();
        msgs.addOutbox(out);
      } catch (e) {
        logger.warn("saving outbox to messages store failed", e);
        try { localStorage.setItem("nostr-outbox", JSON.stringify([out, ...(JSON.parse(localStorage.getItem("nostr-outbox") || "[]") || [])])); } catch {}
      }

      logger.debug("published event", { signed, relayResults });

      return { signed, relayResults };
    }
  }
});
