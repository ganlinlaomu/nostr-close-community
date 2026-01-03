import { db, type DBImageCache } from "@/db/dexie";
import { logger } from "@/utils/logger";

// Cache expiration time: 7 days in milliseconds
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Store decrypted image in cache
 */
export async function storeImageInCache(
  url: string,
  blob: Blob,
  mime: string
): Promise<void> {
  try {
    const cacheEntry: DBImageCache = {
      url,
      blob,
      timestamp: Date.now(),
      mime
    };
    await (db as any).imageCache.put(cacheEntry);
    logger.debug(`Cached image: ${url.slice(0, 50)}...`);
  } catch (e) {
    logger.warn("Failed to store image in cache", e);
  }
}

/**
 * Get decrypted image from cache if available and not expired
 */
export async function getImageFromCache(
  url: string
): Promise<{ blob: Blob; mime: string } | null> {
  try {
    const cacheEntry: DBImageCache | undefined = await (db as any).imageCache.get(url);
    if (!cacheEntry) {
      return null;
    }

    // Check if cache is expired
    const age = Date.now() - cacheEntry.timestamp;
    if (age > CACHE_EXPIRATION_MS) {
      // Cache expired, delete it
      await (db as any).imageCache.delete(url);
      logger.debug(`Cache expired for: ${url.slice(0, 50)}...`);
      return null;
    }

    logger.debug(`Cache hit for: ${url.slice(0, 50)}...`);
    return { blob: cacheEntry.blob, mime: cacheEntry.mime };
  } catch (e) {
    logger.warn("Failed to get image from cache", e);
    return null;
  }
}

/**
 * Clear all expired cache entries
 */
export async function clearExpiredCache(): Promise<number> {
  try {
    const now = Date.now();
    const allEntries: DBImageCache[] = await (db as any).imageCache.toArray();
    const expiredUrls = allEntries
      .filter(entry => now - entry.timestamp > CACHE_EXPIRATION_MS)
      .map(entry => entry.url);

    if (expiredUrls.length > 0) {
      await (db as any).imageCache.bulkDelete(expiredUrls);
      logger.info(`Cleared ${expiredUrls.length} expired cache entries`);
    }

    return expiredUrls.length;
  } catch (e) {
    logger.warn("Failed to clear expired cache", e);
    return 0;
  }
}

/**
 * Clear all image cache
 */
export async function clearAllCache(): Promise<void> {
  try {
    await (db as any).imageCache.clear();
    logger.info("Cleared all image cache");
  } catch (e) {
    logger.warn("Failed to clear all cache", e);
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  count: number;
  size: number;
  oldestTimestamp: number;
}> {
  try {
    const entries: DBImageCache[] = await (db as any).imageCache.toArray();
    const count = entries.length;
    let size = 0;
    let oldestTimestamp = 0;

    for (const entry of entries) {
      size += entry.blob.size;
      if (oldestTimestamp === 0 || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
    }

    return { count, size, oldestTimestamp };
  } catch (e) {
    logger.warn("Failed to get cache stats", e);
    return { count: 0, size: 0, oldestTimestamp: 0 };
  }
}
