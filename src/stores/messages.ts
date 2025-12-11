import { defineStore } from "pinia";
import { useKeyStore } from "./keys";

export type InboxItem = {
  id: string;
  pubkey: string;
  created_at: number;
  content: string;
};

export type OutboxItem = {
  id: string;
  created_at: number;
  sent_at: number;
  content: string;
  relayResults: Array<{ relay: string; ok: boolean; reason?: any; ts?: number }>;
};

function inboxKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_inbox_${pk}`;
}
function outboxKeyFor(pk: string | null | undefined) {
  if (!pk) return null;
  return `nostr_outbox_${pk}`;
}

export const useMessagesStore = defineStore("messages", {
  state: () => ({
    inbox: [] as InboxItem[],
    outbox: [] as OutboxItem[],
    loadedFor: "" as string,
    lastSelfSentMessageId: "" as string
  }),
  actions: {
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) {
        this.inbox = [];
        this.outbox = [];
        this.loadedFor = "";
        return;
      }
      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      // load inbox
      try {
        const ik = inboxKeyFor(targetPk);
        if (ik) {
          const rawI = localStorage.getItem(ik);
          this.inbox = rawI ? JSON.parse(rawI) : [];
        } else {
          this.inbox = [];
        }
      } catch {
        this.inbox = [];
      }

      // load outbox
      try {
        const ok = outboxKeyFor(targetPk);
        if (ok) {
          const rawO = localStorage.getItem(ok);
          this.outbox = rawO ? JSON.parse(rawO) : [];
        } else {
          this.outbox = [];
        }
      } catch {
        this.outbox = [];
      }
    },

    saveInbox() {
      const key = inboxKeyFor(this.loadedFor || "");
      if (!key) return;
      try { localStorage.setItem(key, JSON.stringify(this.inbox)); } catch {}
    },

    saveOutbox() {
      const key = outboxKeyFor(this.loadedFor || "");
      if (!key) return;
      try { localStorage.setItem(key, JSON.stringify(this.outbox)); } catch {}
    },

    addInbox(item: InboxItem, isSelfSent = false) {
      if (!item || !item.id) return;
      // prevent exact duplicates
      if (this.inbox.find((m) => m.id === item.id)) return;
      this.inbox.unshift(item);
      // keep bounded history
      if (this.inbox.length > 1000) this.inbox.splice(1000);
      this.saveInbox();
      // Track self-sent messages so UI can show them immediately
      // Note: Set after saveInbox() since saveInbox() is synchronous and completes before watcher fires
      if (isSelfSent) {
        this.lastSelfSentMessageId = item.id;
      }
    },

    addOutbox(item: OutboxItem) {
      if (!item || !item.id) return;
      this.outbox.unshift(item);
      if (this.outbox.length > 500) this.outbox.splice(500);
      this.saveOutbox();
    },

    // remove in-memory lists for current user, optionally remove persisted storage
    reset(removeFromStorage = false) {
      const pk = this.loadedFor || "";
      const ik = inboxKeyFor(pk);
      const ok = outboxKeyFor(pk);
      this.inbox = [];
      this.outbox = [];
      this.loadedFor = "";
      if (removeFromStorage) {
        try { if (ik) localStorage.removeItem(ik); } catch {}
        try { if (ok) localStorage.removeItem(ok); } catch {}
      }
    },

    // debug: list stored pks that have inbox/outbox saved
    storedPks(): string[] {
      try {
        const out: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          if (k.startsWith("nostr_inbox_") || k.startsWith("nostr_outbox_")) {
            const pk = k.split("_").slice(2).join("_");
            if (!out.includes(pk)) out.push(pk);
          }
        }
        return out;
      } catch {
        return [];
      }
    }
  }
});
