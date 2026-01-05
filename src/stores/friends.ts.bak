import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getRelaysFromStorage, subscribe, publish } from "@/nostr/relays";
import { logger } from "@/utils/logger";

/* =========================
 * Types（原样保留）
 * ========================= */

export type Friend = {
  id?: string;
  pubkey: string;
  name: string;
  groups?: string[];
  group?: string;
  note?: string;
};

type StoredFriendData = {
  list: Friend[];
  lastSyncTimestamp: number;
};

function storageKeyFor(pkHex: string | null | undefined) {
  if (!pkHex) return null;
  return `nostr_friends_${pkHex}`;
}

/* =========================
 * 工具函数（新增，但不破坏原结构）
 * ========================= */

function normalizeFriend(f: Friend): Friend {
  return {
    ...f,
    groups: f.groups ?? (f.group ? [f.group] : [])
  };
}

function mergeFriend(oldF: Friend, newF: Friend): Friend {
  return {
    ...oldF,
    ...newF,
    groups: Array.from(
      new Set([...(oldF.groups ?? []), ...(newF.groups ?? [])])
    )
  };
}

function mergeList(local: Friend[], incoming: Friend[]): Friend[] {
  const map = new Map<string, Friend>();

  for (const f of local) {
    map.set(f.pubkey, normalizeFriend(f));
  }

  for (const f of incoming) {
    const nf = normalizeFriend(f);
    const existing = map.get(nf.pubkey);
    map.set(nf.pubkey, existing ? mergeFriend(existing, nf) : nf);
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
    syncError: "",
    version: 0
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
     * Load（严格 timestamp 决策）
     * ========================= */

    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) return;

      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      const key = storageKeyFor(targetPk);
      if (!key) return;

      let localData: StoredFriendData | null = null;

      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            localData = { list: parsed, lastSyncTimestamp: 0 };
          } else if (parsed?.list) {
            localData = parsed;
          }
        }
      } catch (e) {
        logger.warn("Failed to parse local friend data", e);
      }

      if (!ks.isLoggedIn || !ks.supportsNip04) {
        if (localData) {
          this.list = localData.list;
          this.lastSyncTimestamp = localData.lastSyncTimestamp;
        }
        return;
      }

      const relayFetched = await this.fetchFromRelays();
      const relayTs = this.lastSyncTimestamp;
      const localTs = localData?.lastSyncTimestamp ?? 0;

      // ===== 决策表 =====
      if (relayFetched) {
        if (!localData || localTs === 0) {
          return; // relay 已写入
        }

        if (relayTs > localTs) {
          return; // relay 更新
        }

        if (relayTs < localTs) {
          this.list = localData.list;
          this.lastSyncTimestamp = localTs;
          this.publishToRelays().catch(() => {});
          return;
        }

        // 相等 → merge
        this.list = mergeList(this.list, localData.list);
        this.save();
        return;
      }

      // relay 无数据
      if (localData) {
        this.list = localData.list;
        this.lastSyncTimestamp = localTs;
        this.publishToRelays().catch(() => {});
      }
    },

    save() {
      const key = storageKeyFor(this.loadedFor);
      if (!key) return;

      const data: StoredFriendData = {
        list: this.list,
        lastSyncTimestamp: this.lastSyncTimestamp
      };

      localStorage.setItem(key, JSON.stringify(data));
    },

    /* =========================
     * 本地修改（永远 bump timestamp）
     * ========================= */

    add(friend: Friend) {
      if (!friend.pubkey || !friend.name?.trim()) return false;
      if (this.list.some(f => f.pubkey === friend.pubkey)) return false;

      this.list.push(normalizeFriend(friend));
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      this.version++;
      this.save();

      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(() => {});
      }
      return true;
    },

    remove(pubkey: string) {
      const before = this.list.length;
      this.list = this.list.filter(f => f.pubkey !== pubkey);
      if (this.list.length === before) return false;

      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      this.version++;
      this.save();

      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(() => {});
      }
      return true;
    },

    update(pubkey: string, patch: Partial<Friend>) {
      const f = this.list.find(x => x.pubkey === pubkey);
      if (!f) return false;
      if (patch.name !== undefined && !patch.name.trim()) return false;

      Object.assign(f, patch);
      this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
      this.version++;
      this.save();

      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(() => {});
      }
      return true;
    },

    /* =========================
     * Relay：只做 IO，不做决策
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
          this.save();
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
        const filters = {
          kinds: [30000],
          authors: [ks.pkHex],
          "#d": ["close-friends"],
          limit: 1
        };

        return new Promise(resolve => {
          let latest: any = null;

          const sub = subscribe(relays, [filters]);

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
                this.save();
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
