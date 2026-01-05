import { getDatabase } from "@/db/dexie";
import { useKeyStore } from "@/stores/keys";
import { logger } from "@/utils/logger";

// 缓存过期时间：7天
const CACHE_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 内部辅助函数：获取当前账号的数据库
 */
function getDB() {
  const ks = useKeyStore();
  // 如果没登录，可能无法获取私有库，这里需要谨慎处理
  return getDatabase(ks.pkHex);
}

/**
 * 存储解密后的图片到当前账号的私有缓存
 */
export async function storeImageInCache(
  url: string,
  blob: Blob,
  mime: string
): Promise<void> {
  const ks = useKeyStore();
  if (!ks.pkHex) return; // 未登录不缓存隐私内容

  try {
    const db = getDB();
    const cacheEntry = {
      url,
      blob,
      timestamp: Date.now(),
      mime
    };
    await db.imageCache.put(cacheEntry);
    logger.debug(`[Cache] 存储图片: ${url.slice(0, 40)}... (账号: ${ks.pkHex.slice(0,8)})`);
  } catch (e) {
    logger.warn("Failed to store image in cache", e);
  }
}

/**
 * 从当前账号的私有库中获取缓存
 */
export async function getImageFromCache(
  url: string
): Promise<{ blob: Blob; mime: string } | null> {
  const ks = useKeyStore();
  if (!ks.pkHex) return null;

  try {
    const db = getDB();
    const cacheEntry = await db.imageCache.get(url);
    if (!cacheEntry) return null;

    // 检查是否过期
    const age = Date.now() - cacheEntry.timestamp;
    if (age > CACHE_EXPIRATION_MS) {
      await db.imageCache.delete(url);
      return null;
    }

    return { blob: cacheEntry.blob, mime: cacheEntry.mime };
  } catch (e) {
    logger.warn("Failed to get image from cache", e);
    return null;
  }
}

/**
 * 清理当前账号的过期缓存
 */
export async function clearExpiredCache(): Promise<number> {
  const ks = useKeyStore();
  if (!ks.pkHex) return 0;

  try {
    const db = getDB();
    const now = Date.now();
    const allEntries = await db.imageCache.toArray();
    const expiredUrls = allEntries
      .filter(entry => now - entry.timestamp > CACHE_EXPIRATION_MS)
      .map(entry => entry.url);

    if (expiredUrls.length > 0) {
      await db.imageCache.bulkDelete(expiredUrls);
      logger.info(`[Cache] 清理了 ${expiredUrls.length} 条过期缓存`);
    }
    return expiredUrls.length;
  } catch (e) {
    return 0;
  }
}

/**
 * 清理当前账号的所有图片缓存
 */
export async function clearAllCache(): Promise<void> {
  try {
    const db = getDB();
    await db.imageCache.clear();
    logger.info("Cleared account-specific image cache");
  } catch (e) {
    logger.warn("Failed to clear cache", e);
  }
}
