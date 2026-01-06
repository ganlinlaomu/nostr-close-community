fimport { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getCurrentDatabase } from "@/db/dexie";
import { getRelaysFromStorage, subscribe, publish } from "@/nostr/relays";
import { logger } from "@/utils/logger";

/* =========================
 * Types（基本保持）
 * ========================= */

export type Friend = {
  pubkey: string;
  name: string;
  groups?: string[];
  note?: string;
};

/* =========================
 * Helpers
 * ========================= */

function normalizeFriend(f: Friend): Friend {
  return {
    ...f,
    groups: f.groups ?? []
  };
}

function mergeList(local: Friend[], incoming: Friend[]): Friend[] {
  const map = new Map<string, Friend>();

  for (const f of local) map.set(f.pubkey, normalizeFriend(f));
  for (const f of incoming) {
    const existing = map.get(f.pubkey);
    map.set(
      f.pubkey,
      existing ? { ...existing, ...f } : normalizeFriend(f)
    );
  }

  return Array.from(map.values());
}

/* =========================
 * Store
 * ========================= */

export const useFriendsStore = defineStore("friends", {
  state: () => ({
    list: [] as Friend[],
    loadedFor: "",
    syncing: false,
    lastSyncTimestamp: 0,
    syncError: ""
  }),

  getters: {
    sortedList(): Friend[] {
      return [...this.list].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "", "zh-CN")
      );
    }
  },

  actions: {
    /* =========================
     * 核心：按 pk 加载（Dexie）
     * ========================= */

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      // 账号切换 → 强制重载
      if (this.loadedFor !== targetPk) {
        this.$reset();
        this.loadedFor = targetPk;
      }

      const db = getCurrentDatabase();

      try {
        const rows = await db.friends.toArray();
        this.list = rows.map(normalizeFriend);

        const meta = await db.meta.get("friends_last_sync");
        this.lastSyncTimestamp = meta?.value ?? 0;
      } catch (e) {
        logger.error("Failed to load friends from db", e);
      }

      if (ks.isLoggedIn && ks.supportsNip04) {
        this.fetchFromRelays().catch(() => {});
      }
    },

    async saveToDB() {
      if (!this.loadedFor) return;
      const db = getDatabase(this.loadedFor);

      await db.transaction("rw", db.friends, db.meta, async () => {
        await db.friends.clear();
        await db.friends.bulkPut(this.list);
        await db.meta.put({
          key: "friends_last_sync",
          value: this.lastSyncTimestamp
        });
      });
    },

    /* =========================
     * 本地修改
     * ========================= */

    async add(friend: Friend) {
      if (!friend.pubkey || !friend.name?.trim()) return false;
      if (this.list.some(f => f.pubkey === friend.pubkey)) return false;

      this.list.push(normalizeFriend(friend));
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      await this.saveToDB();

      const ks = useKeyStore();
      if (ks.supportsNip04) this.publishToRelays().catch(() => {});
      return true;
    },

    async remove(pubkey: string) {
      this.list = this.list.filter(f => f.pubkey !== pubkey);
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      await this.saveToDB();

      const ks = useKeyStore();
      if (ks.supportsNip04) this.publishToRelays().catch(() => {});
      return true;
    },

    async update(pubkey: string, patch: Partial<Friend>) {
      const f = this.list.find(x => x.pubkey === pubkey);
      if (!f) return false;

      Object.assign(f, patch);
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      await this.saveToDB();

      const ks = useKeyStore();
      if (ks.supportsNip04) this.publishToRelays().catch(() => {});
      return true;
    },

    /* =========================
     * Relay 同步（逻辑几乎不变）
     * ========================= */

    async publishToRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.supportsNip04) return false;

      this.syncing = true;
      try {
        const encrypted = await ks.nip04Encrypt(
          ks.pkHex,
          JSON.stringify(this.list)
        );

        const event = await ks.signEvent({
          kind: 30000,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["d", "close-friends"]],
          content: encrypted
        });

        const relays = getRelaysFromStorage();
        const results = await publish(relays, event);

        if (results.some(r => r.ok)) {
          this.lastSyncTimestamp = event.created_at;
          await this.saveToDB();
          return true;
        }
        return false;
      } finally {
        this.syncing = false;
      }
    },

    async fetchFromRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.supportsNip04) return false;

      this.syncing = true;

      try {
        const relays = getRelaysFromStorage();
        const sub = subscribe(relays, [{
          kinds: [30000],
          authors: [ks.pkHex],
          "#d": ["close-friends"],
          limit: 1
        }]);

        return new Promise(resolve => {
          let latest: any = null;

          sub.on("event", evt => {
            if (!latest || evt.created_at > latest.created_at) {
              latest = evt;
            }
          });

          sub.on("eose", async () => {
            sub.unsub();
            if (!latest) {
              this.syncing = false;
              resolve(false);
              return;
            }

            try {
              const decrypted = await ks.nip04Decrypt(
                ks.pkHex,
                latest.content
              );
              const incoming = JSON.parse(decrypted);
              if (Array.isArray(incoming)) {
                this.list = mergeList(this.list, incoming);
                this.lastSyncTimestamp = latest.created_at;
                await this.saveToDB();
                resolve(true);
              } else {
                resolve(false);
              }
            } catch {
              resolve(false);
            } finally {
              this.syncing = false;
            }
          });
        });
      } catch {
        this.syncing = false;
        return false;
      }
    }
  }
});
