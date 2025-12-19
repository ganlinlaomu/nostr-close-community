import { defineStore } from "pinia";
import { pool } from "@/nostr/relays";
import { getRelaysFromStorage } from "@/nostr/relays";
import { useKeyStore } from "@/stores/keys";
import { nip44 } from "nostr-tools";
import { logger } from "@/utils/logger";
import { useMessagesStore } from "@/stores/messages";

/**
 * posts store
 * - publishNip44PerMessage: true NIP-44 encryption
 */
export const usePostsStore = defineStore("posts", {
  state: () => ({
    // optional local state
  }),

  actions: {
    async publishNip44PerMessage(recipients: string[], plaintext: string) {
      const key = useKeyStore();
      if (!key.isLoggedIn) throw new Error("未登录");

      if (!Array.isArray(recipients) || recipients.length === 0) {
        throw new Error("recipients 不能为空");
      }

      // 确保自己能解密
      if (!recipients.includes(key.pkHex)) {
        recipients = [...recipients, key.pkHex];
      }

      // ✅ NIP-44 要求：对每个接收者分别加密
      const encryptedPayloads: Array<{ to: string; content: string }> = [];

      for (const r of recipients) {
        try {
          const encrypted = await nip44.encrypt(
            plaintext,
            key.skHex, // sender sk
            r          // recipient pk
          );
          encryptedPayloads.push({ to: r, content: encrypted });
        } catch (e) {
          logger.warn("nip44 encrypt failed for", r, e);
        }
      }

      if (encryptedPayloads.length === 0) {
        throw new Error("没有成功加密的接收者");
      }

      /**
       * ⚠️ 这里的设计说明
       * - event.content 只能是 string
       * - 我们用 JSON 包装多接收者内容
       * - 这是你原来 per-message 模型的自然升级
       */
      const contentStr = JSON.stringify({
        version: "nip44-per-recipient-v1",
        items: encryptedPayloads
      });

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
          relayResults = pubs.map((p: any) => ({
            relay: p.relay || p.url,
            ok: !!p.ok,
            reason: p.reason,
            ts: p.ts || Date.now()
          }));
        } else {
          relayResults = relays.map((r) => ({
            relay: r,
            ok: true,
            ts: Date.now()
          }));
        }
      } catch (e) {
        logger.warn("publish failed", e);
        relayResults = relays.map((r) => ({
          relay: r,
          ok: false,
          reason: e,
          ts: Date.now()
        }));
      }

      const out = {
        id: signed.id,
        created_at: signed.created_at,
        sent_at: Date.now(),
        content: contentStr,
        relayResults
      };

      // persist into outbox
      try {
        const msgs = useMessagesStore();
        await msgs.load();
        msgs.addOutbox(out);
      } catch (e) {
        logger.warn("saving outbox failed", e);
        try {
          localStorage.setItem(
            "nostr-outbox",
            JSON.stringify([
              out,
              ...(JSON.parse(localStorage.getItem("nostr-outbox") || "[]") || [])
            ])
          );
        } catch {}
      }

      logger.debug("published nip44 event", { signed, relayResults });
      return { signed, relayResults };
    }
  }
});
