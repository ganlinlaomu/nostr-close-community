import { defineStore } from "pinia";
import { useKeyStore } from "./keys";

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
    loadedFor: "" as string // pkHex this list was loaded for
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
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.list = parsed;
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
      return true;
    },

    remove(pubkey: string) {
      const idx = this.list.findIndex((f) => f.pubkey === pubkey);
      if (idx === -1) return false;
      this.list.splice(idx, 1);
      this.save();
      return true;
    },

    update(pubkey: string, patch: Partial<Friend>) {
      const f = this.list.find((x) => x.pubkey === pubkey);
      if (!f) return false;
      // Don't allow empty name
      if (patch.name !== undefined && !patch.name.trim()) return false;
      Object.assign(f, patch);
      this.save();
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
    }
  }
});
