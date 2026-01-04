import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getRelaysFromStorage, subscribe, publish, reconnectRelay } from "@/nostr/relays";
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

function storageKeyFor(pkHex: string | null | undefined) {
  if (!pkHex) return null;
  return `nostr_settings_${pkHex}`;
}

/* ------------------------------------------------------------------ */
/* store */
/* ------------------------------------------------------------------ */

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    settings: {
      relays: [] as string[],
      blossomServers: [] as BlossomServer[]
    } as AppSettings,

    loadedFor: "" as string,

    syncing: false,
    syncError: "",
    lastSyncTimestamp: 0
  }),

  getters: {
    relayList(): string[] {
      return this.settings.relays;
    },
    blossomList(): BlossomServer[] {
      return this.settings.blossomServers;
    }
  },

  actions: {
    /* ================================================================
     * load — 只做本地恢复（不 fetch / 不 publish）
     * ================================================================ */
    load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk || this.loadedFor === targetPk) return;

      this.loadedFor = targetPk;

      const key = storageKeyFor(targetPk);
      if (!key) return;

      try {
        const raw = localStorage.getItem(key);
        if (!raw) return;

        const parsed = JSON.parse(raw) as StoredSettingsData;
        if (!parsed?.settings) return;

        this.settings = parsed.settings;
        this.lastSyncTimestamp = parsed.lastSyncTimestamp || 0;

        this.applySettings();
      } catch (e) {
        logger.error("Failed to load local settings", e);
      }
    },

    /* ================================================================
     * apply — 应用当前 settings（无副作用）
     * ================================================================ */
    applySettings() {
      /* relay */
      try {
        const relaysText = this.settings.relays.join("\n");
        localStorage.setItem("custom-relays", relaysText);

        for (const url of this.settings.relays) {
          try {
            reconnectRelay(url);
          } catch {}
        }
      } catch (e) {
        logger.error("Apply relay settings failed", e);
      }

      /* blossom */
      try {
        localStorage.setItem(
          "blossom_servers",
          JSON.stringify(this.settings.blossomServers)
        );

        if (this.settings.blossomServers[0]) {
          localStorage.setItem(
            "blossom_upload_url",
            this.settings.blossomServers[0].url
          );
          localStorage.setItem(
            "blossom_token",
            this.settings.blossomServers[0].token || ""
          );
        }

        window.dispatchEvent(
          new CustomEvent("blossom-config-updated", {
            detail: { servers: this.settings.blossomServers }
          })
        );
      } catch (e) {
        logger.error("Apply blossom settings failed", e);
      }
    },

    /* ================================================================
     * save — 本地持久化
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
     * local update（只改本地 + 可选 publish）
     * ================================================================ */
    updateRelays(relays: string[]) {
      this.settings.relays = [...relays];
      this.save();

      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(() => {});
      }
    },

    updateBlossomServers(servers: BlossomServer[]) {
      this.settings.blossomServers = [...servers];
      this.save();

      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(() => {});
      }
    },

    /* ================================================================
     * publish — 只推，不读、不比较
     * ================================================================ */
    async publishToRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.supportsNip04 || !ks.pkHex) {
        this.syncError = "无法同步设置";
        return false;
      }

      this.syncing = true;
      this.syncError = "";

      try {
        const payload = JSON.stringify(this.settings);
        const encrypted = await ks.nip04Encrypt(ks.pkHex, payload);

        const event = await ks.signEvent({
          kind: 30000,
          created_at: Math.floor(Date.now() / 1000),
          tags: [["d", "close-settings"]],
          content: encrypted
        });

        const relays = getRelaysFromStorage();
        const result = await publish(relays, event);

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
     * fetch — 只拉，不 publish
     * ================================================================ */
    async fetchFromRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.supportsNip04 || !ks.pkHex) {
        this.syncError = "无法拉取设置";
        return false;
      }

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

        return new Promise(resolve => {
          let latest: any = null;

          const timer = setTimeout(() => {
            sub.unsub();
            this.syncing = false;
            resolve(false);
          }, 5000);

          sub.on("event", e => {
            if (!latest || e.created_at > latest.created_at) {
              latest = e;
            }
          });

          sub.on("eose", async () => {
            clearTimeout(timer);
            sub.unsub();

            if (!latest) {
              this.syncing = false;
              resolve(false);
              return;
            }

            try {
              const decrypted = await ks.nip04Decrypt(ks.pkHex, latest.content);
              this.settings = JSON.parse(decrypted);
              this.lastSyncTimestamp = latest.created_at;
              this.save();
              this.applySettings();
              resolve(true);
            } catch (e) {
              this.syncError = "解密失败";
              resolve(false);
            } finally {
              this.syncing = false;
            }
          });
        });
      } catch (e) {
        this.syncError = "拉取失败";
        this.syncing = false;
        return false;
      }
    }
  }
});
