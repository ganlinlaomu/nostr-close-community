import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import {
  getRelaysFromStorage,
  subscribe,
  publish,
  reconnectRelay
} from "@/nostr/relays";
import { logger } from "@/utils/logger";

/* ------------------------------------------------------------------ */
/* types */
/* ------------------------------------------------------------------ */

export type BlossomServer = {
  url: string;
  token: string;
};

export type AppSettings = {
  relays: string[];
  blossomServers: BlossomServer[];
};

type StoredSettingsData = {
  settings: AppSettings;
  lastSyncTimestamp: number;
};

function storageKeyFor(pkHex?: string | null) {
  if (!pkHex) return null;
  return `nostr_settings_${pkHex}`;
}

/* ------------------------------------------------------------------ */
/* store */
/* ------------------------------------------------------------------ */

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    settings: {
      relays: [],
      blossomServers: []
    } as AppSettings,

    loadedFor: "" as string,

    syncing: false,
    syncError: "",
    lastSyncTimestamp: 0,

    _isFetching: false
  }),

  getters: {
    relayList: (s) => s.settings.relays,
    blossomList: (s) => s.settings.blossomServers
  },

  actions: {
    /* ================================================================
     * reset — 切账号 / 登出必用
     * ================================================================ */
    reset() {
      this.settings = { relays: [], blossomServers: [] };
      this.loadedFor = "";
      this.syncing = false;
      this.syncError = "";
      this.lastSyncTimestamp = 0;
      this._isFetching = false;
    },

    /* ================================================================
     * load — 按 pk 隔离
     * ================================================================ */
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;

      if (!targetPk) {
        this.reset();
        return;
      }

      // 🔥 切账号
      if (this.loadedFor && this.loadedFor !== targetPk) {
        this.reset();
      }

      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;

      const key = storageKeyFor(targetPk);
      let hasLocal = false;

      /* ---------- local ---------- */
      try {
        const raw = key ? localStorage.getItem(key) : null;
        if (raw) {
          const parsed = JSON.parse(raw) as StoredSettingsData;
          if (parsed?.settings) {
            this.settings = parsed.settings;
            this.lastSyncTimestamp = parsed.lastSyncTimestamp || 0;
            this.applySettings();
            hasLocal = true;
          }
        }
      } catch (e) {
        logger.error("settings local load failed", e);
      }

      /* ---------- relay bootstrap ---------- */
      if (!hasLocal) {
        await this.bootstrapFetch();
      }
    },

    /* ================================================================
     * bootstrapFetch
     * ================================================================ */
    async bootstrapFetch() {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || ks.pkHex !== this.loadedFor) return;

      const prev = this.syncing;
      this.syncing = false;
      try {
        await this.fetchFromRelays();
      } finally {
        this.syncing = prev;
      }
    },

    /* ================================================================
     * apply
     * ================================================================ */
    applySettings() {
      try {
        localStorage.setItem("custom-relays", this.settings.relays.join("\n"));
        for (const r of this.settings.relays) {
          try { reconnectRelay(r); } catch {}
        }
      } catch (e) {
        logger.error("apply relay failed", e);
      }

      try {
        localStorage.setItem(
          "blossom_servers",
          JSON.stringify(this.settings.blossomServers)
        );

        const first = this.settings.blossomServers[0];
        if (first) {
          localStorage.setItem("blossom_upload_url", first.url);
          localStorage.setItem("blossom_token", first.token || "");
        }

        window.dispatchEvent(
          new CustomEvent("blossom-config-updated", {
            detail: { servers: this.settings.blossomServers }
          })
        );
      } catch (e) {
        logger.error("apply blossom failed", e);
      }
    },

    /* ================================================================
     * save
     * ================================================================ */
    save() {
      const key = storageKeyFor(this.loadedFor);
      if (!key) return;

      const data: StoredSettingsData = {
        settings: this.settings,
        lastSyncTimestamp: this.lastSyncTimestamp
      };

      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {}
    },

    /* ================================================================
     * update
     * ================================================================ */
    updateRelays(relays: string[]) {
      this.settings.relays = [...relays];
      this.save();
      if (useKeyStore().supportsNip04) {
        this.publishToRelays().catch(() => {});
      }
    },

    updateBlossomServers(servers: BlossomServer[]) {
      this.settings.blossomServers = [...servers];
      this.save();
      if (useKeyStore().supportsNip04) {
        this.publishToRelays().catch(() => {});
      }
    },

    /* ================================================================
     * publish
     * ================================================================ */
    async publishToRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || ks.pkHex !== this.loadedFor) return false;

      this.syncing = true;
      this.syncError = "";

      try {
        const encrypted = await ks.nip04Encrypt(
          ks.pkHex,
          JSON.stringify(this.settings)
        );

        const event = await ks.signEvent({
          kind: 30000,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["d", "close-settings"]],
          content: encrypted
        });

        const result = await publish(getRelaysFromStorage(), event);
        if (!result.some(r => r.ok)) {
          this.syncError = "所有 relay 发布失败";
          return false;
        }

        this.lastSyncTimestamp = event.created_at;
        this.save();
        return true;
      } catch (e: any) {
        this.syncError = e.message || "发布失败";
        return false;
      } finally {
        this.syncing = false;
      }
    },

    /* ================================================================
     * fetch
     * ================================================================ */
    async fetchFromRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || ks.pkHex !== this.loadedFor) return false;
      if (this._isFetching) return false;

      this._isFetching = true;
      this.syncing = true;
      this.syncError = "";

      try {
        const relays = getRelaysFromStorage();
        const sub = subscribe(relays, [{
          kinds: [30000],
          authors: [ks.pkHex],
          "#d": ["close-settings"],
          limit: 1
        }]);

        return await new Promise(resolve => {
          let latest: any = null;
          const timer = setTimeout(() => finish(false), 5000);

          const finish = (ok: boolean) => {
            clearTimeout(timer);
            try { sub.unsub(); } catch {}
            resolve(ok);
          };

          sub.on("event", e => {
            if (!latest || e.created_at > latest.created_at) {
              latest = e;
            }
          });

          sub.on("eose", async () => {
            if (!latest) return finish(false);
            try {
              const dec = await ks.nip04Decrypt(ks.pkHex, latest.content);
              this.settings = JSON.parse(dec);
              this.lastSyncTimestamp = latest.created_at;
              this.save();
              this.applySettings();
              finish(true);
            } catch {
              this.syncError = "解密失败";
              finish(false);
            }
          });
        });
      } finally {
        this.syncing = false;
        this._isFetching = false;
      }
    }
  }
});