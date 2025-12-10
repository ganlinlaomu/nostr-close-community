import { defineStore } from "pinia";
import { useKeyStore } from "./keys";
import { getRelaysFromStorage, subscribe, publish } from "@/nostr/relays";
import { logger } from "@/utils/logger";

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

export const useSettingsStore = defineStore("settings", {
  state: () => ({
    settings: {
      relays: [] as string[],
      blossomServers: [] as BlossomServer[]
    } as AppSettings,
    loadedFor: "" as string, // pkHex this settings was loaded for
    syncing: false as boolean, // whether sync is in progress
    lastSyncTimestamp: 0 as number, // timestamp of last successful sync
    syncError: "" as string // last sync error message
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
    // load settings for current logged-in key (or provided pk)
    async load(pk?: string) {
      const ks = useKeyStore();
      const targetPk = pk ?? ks.pkHex;
      if (!targetPk) {
        this.settings = { relays: [], blossomServers: [] };
        this.loadedFor = "";
        return;
      }
      // if already loaded for same pk, skip
      if (this.loadedFor === targetPk) return;
      this.loadedFor = targetPk;
      const key = storageKeyFor(targetPk);
      if (!key) {
        this.settings = { relays: [], blossomServers: [] };
        return;
      }
      try {
        const raw = localStorage.getItem(key);
        let localData: StoredSettingsData | null = null;
        
        // Parse local storage data
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            // Handle both old format (direct AppSettings) and new format (object with timestamp)
            if (parsed && typeof parsed === 'object') {
              if (parsed.settings && typeof parsed.settings === 'object') {
                // New format: object with settings and timestamp
                localData = parsed;
              } else if (Array.isArray(parsed.relays)) {
                // Old format: just AppSettings object, no timestamp
                localData = {
                  settings: parsed,
                  lastSyncTimestamp: 0 // Unknown timestamp for old data
                };
              }
            }
          } catch (e) {
            logger.warn("Failed to parse local settings data", e);
          }
        }

        // If NIP-04 is supported, fetch from relays to compare with local data
        if (ks.isLoggedIn && ks.supportsNip04) {
          const relayFetched = await this.fetchFromRelays();
          // Note: fetchFromRelays() updates this.lastSyncTimestamp if data is found
          const fetchedTimestamp = this.lastSyncTimestamp;
          
          if (relayFetched) {
            // We got data from relay
            if (!localData || (localData.settings.relays.length === 0 && localData.settings.blossomServers.length === 0)) {
              // No local data or empty local data, use relay data
              logger.info("Using relay settings (no local data)");
              return;
            } else if (fetchedTimestamp > localData.lastSyncTimestamp) {
              // Relay data is newer, already loaded by fetchFromRelays
              logger.info(`Using relay settings (newer: ${fetchedTimestamp} > ${localData.lastSyncTimestamp})`);
              return;
            } else if (fetchedTimestamp < localData.lastSyncTimestamp) {
              // Local data is newer, restore local and publish to relay
              logger.info(`Using local settings (newer: ${localData.lastSyncTimestamp} > ${fetchedTimestamp})`);
              this.settings = localData.settings;
              this.lastSyncTimestamp = localData.lastSyncTimestamp;
              // Publish local data to relay since it's newer
              this.publishToRelays().catch(e => logger.warn("Failed to publish newer local settings", e));
              return;
            } else {
              // Timestamps are equal, use relay data (it's already loaded)
              logger.info("Local and relay settings have same timestamp, using relay data");
              return;
            }
          } else {
            // No data from relay (or fetch failed)
            if (localData && (localData.settings.relays.length > 0 || localData.settings.blossomServers.length > 0)) {
              // Use local data and publish to relay
              logger.info("Using local settings (relay has no data or fetch failed)");
              this.settings = localData.settings;
              this.lastSyncTimestamp = localData.lastSyncTimestamp;
              // Publish to relay to ensure sync
              this.publishToRelays().catch(e => logger.warn("Failed to publish local settings to relay", e));
              return;
            } else {
              // No data anywhere
              this.settings = { relays: [], blossomServers: [] };
              this.lastSyncTimestamp = 0;
              return;
            }
          }
        } else {
          // NIP-04 not supported, just use local data
          if (localData) {
            this.settings = localData.settings;
            this.lastSyncTimestamp = localData.lastSyncTimestamp;
          } else {
            this.settings = { relays: [], blossomServers: [] };
            this.lastSyncTimestamp = 0;
          }
        }
      } catch (e) {
        logger.error("Error loading settings", e);
        this.settings = { relays: [], blossomServers: [] };
        this.lastSyncTimestamp = 0;
      }
    },

    // save current settings to storage under current loadedFor pk
    save() {
      const key = storageKeyFor(this.loadedFor || "");
      if (!key) return;
      try {
        const data: StoredSettingsData = {
          settings: this.settings,
          lastSyncTimestamp: this.lastSyncTimestamp
        };
        localStorage.setItem(key, JSON.stringify(data));
      } catch {
        // ignore storage errors
      }
    },

    updateRelays(relays: string[]) {
      this.settings.relays = [...relays];
      this.save();
      // Sync to relays in background (don't wait) - only if NIP-04 is supported
      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(e => logger.warn("Failed to sync settings after relay update", e));
      }
      return true;
    },

    updateBlossomServers(servers: BlossomServer[]) {
      this.settings.blossomServers = [...servers];
      this.save();
      // Sync to relays in background (don't wait) - only if NIP-04 is supported
      const ks = useKeyStore();
      if (ks.supportsNip04) {
        this.publishToRelays().catch(e => logger.warn("Failed to sync settings after blossom update", e));
      }
      return true;
    },

    // Reset in-memory settings for current loadedFor.
    // If removeFromStorage is true, also remove the stored settings for that pk.
    reset(removeFromStorage = false) {
      const key = storageKeyFor(this.loadedFor || "");
      this.settings = { relays: [], blossomServers: [] };
      if (removeFromStorage && key) {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
      this.loadedFor = "";
    },

    /**
     * Publish encrypted settings to relays using NIP-51 (kind 30000)
     * This allows settings to sync across devices
     */
    async publishToRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.pkHex) {
        logger.warn("Cannot publish settings: user not logged in");
        this.syncError = "未登录";
        return false;
      }

      // Check if current login method supports NIP-04
      if (!ks.supportsNip04) {
        logger.warn("Cannot publish settings: NIP-04 not supported by current login method");
        this.syncError = "当前登录方式不支持 NIP-04 加密";
        return false;
      }

      this.syncing = true;
      this.syncError = "";

      try {
        // Prepare settings data
        const settingsData = {
          relays: this.settings.relays,
          blossomServers: this.settings.blossomServers
        };

        // Encrypt the settings content using NIP-04
        const plainContent = JSON.stringify(settingsData);
        const encryptedContent = await ks.nip04Encrypt(ks.pkHex, plainContent);

        // Build tags for the event
        const tags: string[][] = [
          ["d", "close-settings"] // parameterized replaceable event identifier
        ];

        // Create the event
        const eventTemplate = {
          kind: 30000, // Parameterized Replaceable Event (NIP-01) for user settings
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
          logger.warn("Failed to publish settings to any relay");
          this.syncError = "所有中继发布失败";
          return false;
        }

        logger.info(`Settings published to ${successCount}/${relays.length} relays`);
        this.lastSyncTimestamp = Math.floor(Date.now() / 1000);
        this.save(); // Save the updated timestamp to localStorage
        return true;
      } catch (e: any) {
        logger.error("Failed to publish settings", e);
        this.syncError = e.message || "发布失败";
        return false;
      } finally {
        this.syncing = false;
      }
    },

    /**
     * Fetch and decrypt settings from relays using NIP-51 (kind 30000)
     * This restores settings from relays when logging in on a new device
     */
    async fetchFromRelays(): Promise<boolean> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn || !ks.pkHex) {
        logger.warn("Cannot fetch settings: user not logged in");
        this.syncError = "未登录";
        return false;
      }

      // Check if current login method supports NIP-04
      if (!ks.supportsNip04) {
        logger.warn("Cannot fetch settings: NIP-04 not supported by current login method");
        this.syncError = "当前登录方式不支持 NIP-04 解密";
        return false;
      }

      this.syncing = true;
      this.syncError = "";

      try {
        const relays = getRelaysFromStorage();
        
        // Subscribe to kind 30000 events with d tag "close-settings"
        const filters = {
          kinds: [30000],
          authors: [ks.pkHex],
          "#d": ["close-settings"],
          limit: 1 // Only get the latest one (parameterized replaceable event)
        };

        let latestEvent: any = null;
        let receivedEose = false;

        return new Promise<boolean>((resolve) => {
          const sub = subscribe(relays, [filters]);
          
          const timeoutId = setTimeout(() => {
            sub.unsub();
            // Process event even if we timeout (might have received it but not EOSE)
            if (latestEvent) {
              (async () => {
                try {
                  const decryptedContent = await ks.nip04Decrypt(ks.pkHex, latestEvent.content);
                  const settingsData = JSON.parse(decryptedContent);
                  if (settingsData && typeof settingsData === 'object') {
                    this.settings = {
                      relays: settingsData.relays || [],
                      blossomServers: settingsData.blossomServers || []
                    };
                    this.save();
                    this.lastSyncTimestamp = latestEvent.created_at;
                    logger.info(`Fetched settings from relays (timeout)`);
                    this.syncing = false;
                    resolve(true);
                  } else {
                    logger.warn("Invalid settings format from relay");
                    this.syncError = "数据格式无效";
                    this.syncing = false;
                    resolve(false);
                  }
                } catch (e: any) {
                  logger.error("Failed to decrypt settings on timeout", e);
                  this.syncError = e.message || "解密失败";
                  this.syncing = false;
                  resolve(false);
                }
              })();
            } else {
              logger.info("No settings found on relays (timeout)");
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
              logger.info("No settings found on relays");
              this.syncing = false;
              resolve(false);
              return;
            }

            try {
              // Decrypt the content
              const decryptedContent = await ks.nip04Decrypt(ks.pkHex, latestEvent.content);
              const settingsData = JSON.parse(decryptedContent);

              if (settingsData && typeof settingsData === 'object') {
                // Replace current settings with fetched data
                this.settings = {
                  relays: settingsData.relays || [],
                  blossomServers: settingsData.blossomServers || []
                };
                this.save(); // Save to localStorage as well
                this.lastSyncTimestamp = latestEvent.created_at;
                logger.info(`Fetched settings from relays`);
                resolve(true);
              } else {
                logger.warn("Invalid settings format from relay");
                this.syncError = "数据格式无效";
                resolve(false);
              }
            } catch (e: any) {
              logger.error("Failed to decrypt or parse settings", e);
              this.syncError = e.message || "解密失败";
              resolve(false);
            } finally {
              this.syncing = false;
            }
          });
        });
      } catch (e: any) {
        logger.error("Failed to fetch settings", e);
        this.syncError = e.message || "获取失败";
        this.syncing = false;
        return false;
      }
    },

    /**
     * Sync settings: fetch from relays, compare timestamps, and sync accordingly
     * This should be called for manual sync to ensure bidirectional synchronization
     */
    async syncWithRelays(): Promise<void> {
      const ks = useKeyStore();
      if (!ks.isLoggedIn) return;
      if (!ks.supportsNip04) {
        this.syncError = "当前登录方式不支持同步";
        return;
      }

      this.syncing = true;
      this.syncError = "";
      
      try {
        // Store current local state before fetching
        const localSettings = { ...this.settings };
        const localTimestamp = this.lastSyncTimestamp;
        
        // Fetch from relays
        const relayFetched = await this.fetchFromRelays();
        // Note: fetchFromRelays() updates this.lastSyncTimestamp if data is found
        const fetchedTimestamp = this.lastSyncTimestamp;
        
        if (relayFetched) {
          // Got data from relay, compare timestamps
          if (fetchedTimestamp >= localTimestamp) {
            // Relay data is newer or equal, already loaded by fetchFromRelays
            logger.info("Sync: Using relay settings (newer or equal)");
            this.save();
          } else if (localSettings.relays.length > 0 || localSettings.blossomServers.length > 0) {
            // Local data is newer, restore and publish
            logger.info("Sync: Local settings are newer, publishing to relay");
            this.settings = localSettings;
            this.lastSyncTimestamp = localTimestamp;
            await this.publishToRelays();
          }
        } else {
          // No data from relay or fetch failed
          if (localSettings.relays.length > 0 || localSettings.blossomServers.length > 0) {
            // Restore local data and publish
            logger.info("Sync: No relay settings, publishing local settings");
            this.settings = localSettings;
            this.lastSyncTimestamp = localTimestamp;
            await this.publishToRelays();
          } else {
            logger.info("Sync: No settings to sync");
          }
        }
      } catch (e: any) {
        logger.error("Sync failed", e);
        this.syncError = e.message || "同步失败";
      } finally {
        this.syncing = false;
      }
    }
  }
});
