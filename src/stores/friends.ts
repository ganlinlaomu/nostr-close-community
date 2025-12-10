import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getRelaysFromStorage, subscribe, publish } from "@/nostr/relays";
import { logger } from "@/utils/logger";

export type Friend = {
  id?: string; // optional internal id
  pubkey: string;
  name: string; // required nickname for new friends
  groups?: string[]; // multiple group tags
  group?: string; // legacy single group field (for backward compatibility)
  note?: string;
};

function storageKeyFor(pkHex: string | null | undefined) {
  if (!pkHex) return null;
  return `nostr_friends_${pkHex}`;
}

export const useFriendsStore = defineStore("friends", {
  state: () => ({
    list: [] as Friend[],
    loadedFor: "" as string, // pkHex this list was loaded for
    syncing: false as boolean, // whether sync is in progress
    lastSyncTimestamp: 0 as number, // timestamp of last successful sync
    syncError: "" as string // last sync error message
  }),
  getters: {
    // Get friends sorted by nickname
    sortedList(): Friend[] {
      return [...this.list].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB, 'zh-CN');
      });
    }
  },
  actions: {
    // load friend list for current logged-in key (or provided pk)
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) {
        this.list = [];
        this.loadedFor = "";
        return;
      }
      // if already loaded for same pk, skip
      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;
      const key = storageKeyFor(targetPk);
      if (!key) {
        this.list = [];
        return;
      }
      try {
        const raw = localStorage.getItem(key);
        if (!raw) {
          this.list = [];
          // If no local data, try to fetch from relays (only if NIP-04 is supported)
          if (ks.isLoggedIn && ks.supportsNip04) {
            await this.fetchFromRelays();
          }
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.list = parsed;
          // If we have local data, sync in background to ensure relays are updated (only if NIP-04 is supported)
          if (ks.isLoggedIn && this.list.length > 0 && ks.supportsNip04) {
            this.publishToRelays().catch(e => logger.warn("Background sync failed", e));
          }
        } else {
          this.list = [];
        }
      } catch {
        this.list = [];
      }
    },

    // save current list to storage under current loadedFor pk
    save() {
      const key = storageKeyFor(this.loadedFor || "");
      if (!key) return;
      try {
        localStorage.setItem(key, JSON.stringify(this.list));
      } catch {
        // ignore storage errors
      }
    },

    add(friend: Friend) {
      if (!friend || !friend.pubkey) return false;
      if (!friend.name || !friend.name.trim()) return false; // require name
      // prevent duplicate by pubkey
      if (this.list.find((f) => f.pubkey === friend.pubkey)) return false;
      this.list.push({ ...friend });
      this.save();
      // Sync to relays in background (don't wait) - only if NIP-04 is supported
      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(e => logger.warn("Failed to sync friend list after add", e));
      }
      return true;
    },

    remove(pubkey: string) {
      const idx = this.list.findIndex((f) => f.pubkey === pubkey);
      if (idx === -1) return false;
      this.list.splice(idx, 1);
      this.save();
      // Sync to relays in background (don't wait) - only if NIP-04 is supported
      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(e => logger.warn("Failed to sync friend list after remove", e));
      }
      return true;
    },

    update(pubkey: string, patch: Partial<Friend>) {
      const f = this.list.find((x) => x.pubkey === pubkey);
      if (!f) return false;
      // Don't allow empty name
      if (patch.name !== undefined && !patch.name.trim()) return false;
      Object.assign(f, patch);
      this.save();
      // Sync to relays in background (don't wait) - only if NIP-04 is supported
      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(e => logger.warn("Failed to sync friend list after update", e));
      }
      return true;
    },

    // Reset in-memory friend list for current loadedFor.
    // If removeFromStorage is true, also remove the stored list for that pk.
    reset(removeFromStorage = false) {
      const key = storageKeyFor(this.loadedFor || "");
      this.list = [];
      if (removeFromStorage && key) {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
      this.loadedFor = "";
    },

    // utility: get all stored friend keys (for debugging or UI)
    storedPks(): string[] {
      try {
        const out: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("nostr_friends_")) {
            out.push(k.replace("nostr_friends_", ""));
          }
        }
        return out;
      } catch {
        return [];
      }
    },

    /**
     * Publish encrypted friend list to relays using NIP-51 (kind 30000)
     * This allows friend lists to sync across devices
     */
    async publishToRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.pkHex) {
        logger.warn("Cannot publish friend list: user not logged in");
        this.syncError = "未登录";
        return false;
      }

      // Check if current login method supports NIP-04
      if (!ks.supportsNip04) {
        logger.warn("Cannot publish friend list: NIP-04 not supported by current login method");
        this.syncError = "当前登录方式不支持 NIP-04 加密";
        return false;
      }

      this.syncing = true;
      this.syncError = "";

      try {
        // Prepare friend list data
        const friendsData = this.list.map(f => ({
          pubkey: f.pubkey,
          name: f.name,
          groups: f.groups,
          group: f.group,
          note: f.note
        }));

        // Encrypt the friend list content using NIP-04
        const plainContent = JSON.stringify(friendsData);
        const encryptedContent = await ks.nip04Encrypt(ks.pkHex, plainContent);

        // Build tags for the event
        const tags: string[][] = [
          ["d", "close-friends"] // parameterized replaceable event identifier
        ];

        // Add "p" tags for each friend (for compatibility with NIP-51)
        for (const friend of this.list) {
          const pTag = ["p", friend.pubkey];
          if (friend.name) {
            pTag.push("", friend.name); // relay hint empty, petname as third element
          }
          tags.push(pTag);
        }

        // Create the event
        const eventTemplate = {
          kind: 30000, // NIP-51 People List
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: encryptedContent
        };

        // Sign the event
        const signedEvent = await ks.signEvent(eventTemplate);

        // Publish to relays
        const relays = getRelaysFromStorage();
        const results = await publish(relays, signedEvent);

        // Check if at least one relay accepted the event
        const successCount = results.filter(r => r.ok).length;
        if (successCount === 0) {
          logger.warn("Failed to publish friend list to any relay");
          this.syncError = "所有中继发布失败";
          return false;
        }

        logger.info(`Friend list published to ${successCount}/${relays.length} relays`);
        this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
        return true;
      } catch (e: any) {
        logger.error("Failed to publish friend list", e);
        this.syncError = e.message || "发布失败";
        return false;
      } finally {
        this.syncing = false;
      }
    },

    /**
     * Fetch and decrypt friend list from relays using NIP-51 (kind 30000)
     * This restores friend list from relays when logging in on a new device
     */
    async fetchFromRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.pkHex) {
        logger.warn("Cannot fetch friend list: user not logged in");
        this.syncError = "未登录";
        return false;
      }

      // Check if current login method supports NIP-04
      if (!ks.supportsNip04) {
        logger.warn("Cannot fetch friend list: NIP-04 not supported by current login method");
        this.syncError = "当前登录方式不支持 NIP-04 解密";
        return false;
      }

      this.syncing = true;
      this.syncError = "";

      try {
        const relays = getRelaysFromStorage();
        
        // Subscribe to kind 30000 events with d tag "close-friends"
        const filters = {
          kinds: [30000],
          authors: [ks.pkHex],
          "#d": ["close-friends"],
          limit: 1 // Only get the latest one (replaceable event)
        };

        let latestEvent: any = null;
        let receivedEose = false;

        return new Promise<boolean>((resolve) => {
          const sub = subscribe(relays, [filters]);
          
          const timeoutId = setTimeout(() => {
            sub.unsub();
            if (!latestEvent) {
              logger.info("No friend list found on relays (timeout)");
              this.syncing = false;
              resolve(false);
            }
          }, 5000); // 5 second timeout

          sub.on("event", (evt: any) => {
            if (!latestEvent || evt.created_at > latestEvent.created_at) {
              latestEvent = evt;
            }
          });

          sub.on("eose", async () => {
            if (receivedEose) return;
            receivedEose = true;
            
            clearTimeout(timeoutId);
            sub.unsub();

            if (!latestEvent) {
              logger.info("No friend list found on relays");
              this.syncing = false;
              resolve(false);
              return;
            }

            try {
              // Decrypt the content
              const decryptedContent = await ks.nip04Decrypt(ks.pkHex, latestEvent.content);
              const friendsData = JSON.parse(decryptedContent);

              if (Array.isArray(friendsData)) {
                // Replace current list with fetched data
                this.list = friendsData;
                this.save(); // Save to localStorage as well
                this.lastSyncTimestamp = latestEvent.created_at;
                logger.info(`Fetched ${friendsData.length} friends from relays`);
                resolve(true);
              } else {
                logger.warn("Invalid friend list format from relay");
                this.syncError = "数据格式无效";
                resolve(false);
              }
            } catch (e: any) {
              logger.error("Failed to decrypt or parse friend list", e);
              this.syncError = e.message || "解密失败";
              resolve(false);
            } finally {
              this.syncing = false;
            }
          });
        });
      } catch (e: any) {
        logger.error("Failed to fetch friend list", e);
        this.syncError = e.message || "获取失败";
        this.syncing = false;
        return false;
      }
    },

    /**
     * Sync friend list: fetch from relays if local is empty, then publish current state
     * This should be called on login to ensure sync across devices
     */
    async syncWithRelays(): Promise<void> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn) return;

      // If local list is empty, try to fetch from relays first
      if (this.list.length === 0) {
        await this.fetchFromRelays();
      }

      // Always publish current state to keep relays updated
      await this.publishToRelays();
    }
  }
});
