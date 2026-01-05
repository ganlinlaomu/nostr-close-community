/**
 * Version Manager - Handles app version tracking and update detection
 * Prevents blank screen issues by detecting version mismatches
 */

import { APP_VERSION } from "@/db/dexie";

const VERSION_KEY = "app_version";
const LAST_UPDATE_CHECK_KEY = "last_update_check";

/**
 * Get stored app version from localStorage
 */
export function getStoredVersion(): string | null {
  try {
    return localStorage.getItem(VERSION_KEY);
  } catch (e) {
    console.error("[VersionManager] Failed to get stored version", e);
    return null;
  }
}

/**
 * Store current app version in localStorage
 */
export function storeCurrentVersion(): void {
  try {
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    localStorage.setItem(LAST_UPDATE_CHECK_KEY, Date.now().toString());
  } catch (e) {
    console.error("[VersionManager] Failed to store version", e);
  }
}

/**
 * Check if app version has changed since last visit
 * Returns true if this is a new version (requires handling)
 */
export function hasVersionChanged(): boolean {
  const stored = getStoredVersion();
  
  // First time visit - no version stored yet
  if (!stored) {
    return false;
  }
  
  // Version has changed
  if (stored !== APP_VERSION) {
    console.log(`[VersionManager] Version changed from ${stored} to ${APP_VERSION}`);
    return true;
  }
  
  return false;
}

/**
 * Clear all app data (caches, storage, IndexedDB)
 * Used when version mismatch is detected
 */
export async function clearAllAppData(): Promise<void> {
  console.log("[VersionManager] Clearing all app data...");
  
  try {
    // Clear localStorage (except version markers)
    const keysToKeep = [VERSION_KEY, LAST_UPDATE_CHECK_KEY];
    const allKeys = Object.keys(localStorage);
    allKeys.forEach(key => {
      if (!keysToKeep.includes(key)) {
        localStorage.removeItem(key);
      }
    });
    
    // Clear sessionStorage
    sessionStorage.clear();
    
    // Clear all caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
      console.log("[VersionManager] Cleared caches:", cacheNames);
    }
    
    // Unregister all service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map(registration => registration.unregister())
      );
      console.log("[VersionManager] Unregistered service workers");
    }
    
    // Clear IndexedDB databases
    if ('indexedDB' in window) {
      try {
        // Get all database names (requires IndexedDB v3)
        const databases = await (window.indexedDB as any).databases?.() || [];
        await Promise.all(
          databases.map((db: { name: string }) => {
            return new Promise((resolve, reject) => {
              const request = window.indexedDB.deleteDatabase(db.name);
              request.onsuccess = () => {
                console.log(`[VersionManager] Deleted database: ${db.name}`);
                resolve(undefined);
              };
              request.onerror = () => reject(request.error);
              request.onblocked = () => {
                console.warn(`[VersionManager] Database deletion blocked: ${db.name}`);
                resolve(undefined); // Continue anyway
              };
            });
          })
        );
        
        // Also try to delete the known database name
        await new Promise<void>((resolve, reject) => {
          const request = window.indexedDB.deleteDatabase("closed_community_db");
          request.onsuccess = () => {
            console.log("[VersionManager] Deleted closed_community_db");
            resolve();
          };
          request.onerror = () => {
            console.warn("[VersionManager] Failed to delete closed_community_db");
            resolve(); // Continue anyway
          };
          request.onblocked = () => {
            console.warn("[VersionManager] Database deletion blocked");
            resolve(); // Continue anyway
          };
        });
      } catch (e) {
        console.warn("[VersionManager] IndexedDB cleanup had issues", e);
        // Continue anyway - best effort
      }
    }
    
    console.log("[VersionManager] All app data cleared successfully");
  } catch (e) {
    console.error("[VersionManager] Failed to clear app data", e);
    throw e;
  }
}

/**
 * Handle version update - clear data and prepare for reload
 */
export async function handleVersionUpdate(): Promise<void> {
  console.log("[VersionManager] Handling version update...");
  
  try {
    await clearAllAppData();
    storeCurrentVersion();
  } catch (e) {
    console.error("[VersionManager] Error handling version update", e);
    throw e;
  }
}

/**
 * Initialize version tracking on app start
 * Returns true if a page reload is needed
 */
export function initVersionTracking(): boolean {
  const versionChanged = hasVersionChanged();
  
  if (!versionChanged) {
    // No version change, just update the stored version
    storeCurrentVersion();
    return false;
  }
  
  // Version changed - need to handle update
  return true;
}
