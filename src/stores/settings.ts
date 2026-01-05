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
     * load — 本地恢复 + 首次 bootstrap 同步入口
     * ================================================================ */
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk || this.loadedFor === targetPk) return;

      this.loadedFor = targetPk;

      const key = storageKeyFor(targetPk);
      let hasLocal = false;

      /* ---------- 本地恢复 ---------- */
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
        logger.error("Failed to load local settings", e);
      }

      /* ---------- bootstrap → fetch ---------- */
      if (!hasLocal) {
        await this.bootstrapFetch();
      }
    },

    /* ================================================================
     * bootstrapFetch — 关键新增
     * 1️⃣ 使用当前 relay（内置）
     * 2️⃣ 尝试从 relay 拉取 settings
     * 3️⃣ 拉到即覆盖 / 应用
     * 4️⃣ 拉不到才认为是新账号
     * ================================================================ */
    async bootstrapFetch() {
  const ks = useKeyStore();
  if (!ks.isLoggedIn || !ks.supportsNip04 || !ks.pkHex) return;

  const prevSyncing = this.syncing;
  this.syncing = false;

  try {
    await this.fetchFromRelays();
  } finally {
    this.syncing = prevSyncing;
  }
},

    /* ================================================================
     * apply — 应用当前 settings
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
     * local update（本地 + publish）
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
     * publish — 只推
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
     * fetch — 只拉
     * ================================================================ */
    async fetchFromRelays(): Promise<boolean> {
  const ks = useKeyStore();
  if (!ks.isLoggedIn || !ks.supportsNip04 || !ks.pkHex) {
    return false;
  }

  if (this._isFetching) {
    return false;
  }

  this._isFetching = true;
  this.syncing = true;
  this.syncError = "";

  let finished = false;

  try {
    const relays = getRelaysFromStorage();
    const sub = subscribe(relays, [{
      kinds: [30000],
      authors: [ks.pkHex],
      "#d": ["close-settings"],
      limit: 1
    }]);

    return await new Promise<boolean>(resolve => {
      let latest: any = null;

      const finish = (result: boolean) => {
        if (finished) return;
        finished = true;
        try { sub.unsub(); } catch {}
        resolve(result);
      };

      const timer = setTimeout(() => finish(false), 5000);

      sub.on("event", e => {
        if (!latest || e.created_at > latest.created_at) {
          latest = e;
        }
      });

      sub.on("eose", async () => {
        clearTimeout(timer);

        if (!latest) {
          finish(false);
          return;
        }

        try {
          const decrypted = await ks.nip04Decrypt(ks.pkHex, latest.content);
          this.settings = JSON.parse(decrypted);
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
  } catch {
    this.syncError = "拉取失败";
    return false;
  } finally {
    this.syncing = false;
    this._isFetching = false;
  }
}

  }
});
