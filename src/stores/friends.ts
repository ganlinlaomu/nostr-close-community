import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getCurrentDatabase } from "@/db/dexie";
import { getRelaysFromStorage, subscribe, publish } from "@/nostr/relays";
import { logger } from "@/utils/logger";

/* =========================
 * Types
 * ========================= */

export type Friend = {
  pubkey: string;
  name: string;
  groups?: string[]; // UI 用
  note?: string;
};

/* =========================
 * Helpers
 * ========================= */

function normalizeFromDB(row: any): Friend {
  return {
    pubkey: row.pubkey,
    name: row.name || "",
    groups: row.group ? [row.group] : []
  };
}

function normalizeForDB(f: Friend) {
  return {
    pubkey: f.pubkey,
    name: f.name,
    group: f.groups && f.groups.length > 0 ? f.groups[0] : undefined
  };
}

function mergeList(local: Friend[], incoming: Friend[]): Friend[] {
  const map = new Map<string, Friend>();

  for (const f of local) map.set(f.pubkey, f);
  for (const f of incoming) {
    const old = map.get(f.pubkey);
    map.set(f.pubkey, old ? { ...old, ...f } : f);
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
     * Load (Dexie + Relay)
     * ========================= */

   async load(pk?: string) {
  const ks = useKeyStore();
  const targetPk = pk ?? ks.pkHex;
  if (!targetPk) return;

  // 1. 如果账号变了，必须彻底重置内存状态
  if (this.loadedFor !== targetPk) {
    this.list = [];
    this.lastSyncTimestamp = 0;
    this.loadedFor = targetPk;
  } else if (this.list.length > 0) {
    // 如果已经加载过当前账号且有数据，不再重复读取 DB
    return;
  }

  try {
    const db = getCurrentDatabase(); // 确保 dexie.ts 中 openDatabase 已完成
    const rows = await db.friends.toArray();
    this.list = rows.map(normalizeFromDB);

    const meta = await db.meta.get("friends_last_sync");
    this.lastSyncTimestamp = meta?.value ?? 0;
  } catch (e) {
    logger.error("[friends] load db failed", e);
  }

      // Relay 同步（只要能 nip04 就拉）
      if (ks.isLoggedIn && ks.loginMethod !== "nip07") {
        this.fetchFromRelays().catch(() => {});
      }
    },

    async saveToDB() {
  if (!this.loadedFor) return;

  const db = getCurrentDatabase();

  try {
    // 确保事务涵盖了所有涉及的表
    await db.transaction("rw", [db.friends, db.meta], async () => {
      await db.friends.clear();
      // 使用转换后的数据格式存入
      const rowsForDB = this.list.map(normalizeForDB);
      if (rowsForDB.length > 0) {
        await db.friends.bulkPut(rowsForDB);
      }
      
      await db.meta.put({
        key: "friends_last_sync",
        value: this.lastSyncTimestamp
      });
    });
  } catch (e) {
    logger.error("[friends] transaction failed", e);
  }
},

    /* =========================
     * Local ops
     * ========================= */

    async add(friend: Friend) {
      if (!friend.pubkey || !friend.name) return false;
      if (this.list.some(f => f.pubkey === friend.pubkey)) return false;

      this.list.push(friend);
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      await this.saveToDB();

      this.publishToRelays().catch(() => {});
      return true;
    },

    async update(pubkey: string, patch: Partial<Friend>) {
      const f = this.list.find(x => x.pubkey === pubkey);
      if (!f) return false;

      Object.assign(f, patch);
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      await this.saveToDB();

      this.publishToRelays().catch(() => {});
      return true;
    },

    async remove(pubkey: string) {
      this.list = this.list.filter(f => f.pubkey !== pubkey);
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      await this.saveToDB();

      this.publishToRelays().catch(() => {});
      return true;
    },

    /* =========================
     * Relay (kind:30000, encrypted)
     * ========================= */

    async publishToRelays() {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.nip04Encrypt) return false;

      this.syncing = true;
      this.syncError = "";

      try {
        const encrypted = await ks.nip04Encrypt(
          ks.pkHex,
          JSON.stringify(this.list)
        );

        const evt = await ks.signEvent({
          kind: 30000,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["d", "close-friends"]],
          content: encrypted
        });

        const relays = getRelaysFromStorage();
        const results = await publish(relays, evt);

        if (results.some(r => r.ok)) {
          this.lastSyncTimestamp = evt.created_at;
          await this.saveToDB();
          return true;
        }

        return false;
      } catch (e) {
        this.syncError = "同步失败";
        logger.error("[friends] publish failed", e);
        return false;
      } finally {
        this.syncing = false;
      }
    },

    async fetchFromRelays() {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.nip04Decrypt) return false;

      this.syncing = true;
      this.syncError = "";

      try {
        const relays = getRelaysFromStorage();
        const sub = subscribe(relays, [
          {
            kinds: [30000],
            authors: [ks.pkHex],
            "#d": ["close-friends"],
            limit: 1
          }
        ]);

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
            } catch (e) {
              logger.error("[friends] decrypt failed", e);
              resolve(false);
            } finally {
              this.syncing = false;
            }
          });
        });
      } catch (e) {
        this.syncError = "同步失败";
        this.syncing = false;
        return false;
      }
    }
  }
});