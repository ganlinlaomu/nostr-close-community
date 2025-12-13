/**
 * Nostr Backfill and Batch Fetching Utility
 * 
 * Implements a generic backfill strategy for Nostr events with:
 * - Time-based pagination (backward from newest to oldest)
 * - Author batching (to avoid overwhelming relays)
 * - Breakpoint tracking (for incremental fetches)
 * - Configurable limits and time windows
 */

import { subscribe } from "@/nostr/relays";
import { logger } from "@/utils/logger";

export type BackfillFilter = {
  kinds: number[];
  authors?: string[];
  since?: number;
  until?: number;
  limit?: number;
  [key: string]: any; // Allow additional filter properties like '#g', '#p', etc.
};

export type BackfillOptions = {
  relays: string[];
  filters: BackfillFilter;
  onEvent: (event: any) => Promise<void> | void;
  onProgress?: (stats: BackfillStats) => void;
  onComplete?: (stats: BackfillStats) => void;
  maxBatches?: number; // Maximum number of batches to fetch (default: unlimited)
  batchSize?: number; // Number of events per batch (limit)
  authorBatchSize?: number; // Number of authors per batch (default: 50)
  timeoutMs?: number; // Timeout per batch in milliseconds (default: 10000)
};

export type BackfillStats = {
  totalEvents: number;
  batchesFetched: number;
  oldestTimestamp: number;
  latestTimestamp: number;
  completed: boolean;
};

/**
 * Batch authors into smaller groups to avoid overloading relays
 */
function batchAuthors(authors: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < authors.length; i += batchSize) {
    batches.push(authors.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Fetch events with time-based pagination (backward)
 * 
 * This function implements backward time pagination:
 * - Starts from `until` (or current time if not provided)
 * - Fetches events in batches with `limit`
 * - For next batch, sets `until` to oldest event timestamp - 1
 * - Continues until `since` is reached or no more events
 */
export async function backfillEvents(options: BackfillOptions): Promise<BackfillStats> {
  const {
    relays,
    filters,
    onEvent,
    onProgress,
    onComplete,
    maxBatches = Infinity,
    batchSize = 500,
    authorBatchSize = 50,
    timeoutMs = 10000
  } = options;

  const stats: BackfillStats = {
    totalEvents: 0,
    batchesFetched: 0,
    oldestTimestamp: 0, // Changed from Infinity to 0
    latestTimestamp: 0,
    completed: false
  };

  // Check if authors field exists and has values
  const hasAuthors = Array.isArray(filters.authors) && filters.authors.length > 0;
  
  // If authors are provided, batch them; otherwise, use a single batch with no authors
  const authorBatches = hasAuthors 
    ? batchAuthors(filters.authors!, authorBatchSize)
    : [undefined];

  const targetSince = filters.since || 0;
  const initialUntil = filters.until || Math.floor(Date.now() / 1000);
  
  // Log differently based on whether we have authors or not
  if (hasAuthors) {
    logger.info(`开始回填: kinds=[${filters.kinds.join(',')}], 作者批次数=${authorBatches.length}, 每批作者数=${authorBatches[0]!.length}`);
  } else {
    // For non-author filters (e.g., #p, #e, #g), log the actual filter keys
    const filterKeys = Object.keys(filters).filter(k => k.startsWith('#')).join(', ');
    logger.info(`开始回填: kinds=[${filters.kinds.join(',')}], 过滤条件=${filterKeys || '无标签过滤'}`);
  }
  logger.info(`时间范围: since=${new Date(targetSince * 1000).toLocaleString()} (${targetSince}), until=${new Date(initialUntil * 1000).toLocaleString()} (${initialUntil})`);

  // Process each author batch (or single batch for non-author filters)
  for (let authorBatchIdx = 0; authorBatchIdx < authorBatches.length; authorBatchIdx++) {
    const authorBatch = authorBatches[authorBatchIdx];
    
    // Log batch processing - differentiate between author and non-author filters
    if (hasAuthors && authorBatch) {
      logger.info(`处理作者批次 ${authorBatchIdx + 1}/${authorBatches.length} (${authorBatch.length}个作者)`);
    } else if (authorBatches.length === 1) {
      // Single batch for non-author filters (e.g., #p)
      logger.info(`处理回填批次 (非作者过滤)`);
    }
    
    // Each author batch starts from the initial until time and pages backward
    let currentUntil = initialUntil;
    let batchCount = 0;

    // Continue fetching batches for this author group
    while (batchCount < maxBatches) {
      if (currentUntil <= targetSince) {
        logger.info(`已到达时间边界，停止回填`);
        break;
      }

      // Build filter for this batch
      const batchFilter: BackfillFilter = {
        ...filters,
        limit: batchSize,
        until: currentUntil,
        since: targetSince
      };

      // Add authors for this batch if present
      if (authorBatch) {
        batchFilter.authors = authorBatch;
      }

      // Log the actual filter being sent for debugging
      const filterSummary: any = {
        kinds: batchFilter.kinds,
        since: new Date(targetSince * 1000).toISOString(),
        until: new Date(currentUntil * 1000).toISOString(),
        limit: batchSize
      };
      
      // Add author count or tag filters to summary
      if (batchFilter.authors) {
        filterSummary.authors = `${batchFilter.authors.length} authors`;
      }
      Object.keys(batchFilter).forEach(key => {
        if (key.startsWith('#')) {
          const tagValues = batchFilter[key];
          filterSummary[key] = Array.isArray(tagValues) ? `${tagValues.length} values` : tagValues;
        }
      });
      
      logger.debug(`发送批次 #${batchCount + 1} REQ:`, JSON.stringify(filterSummary));

      // Fetch events for this batch
      const batchEvents: any[] = [];
      let oldestInBatch = currentUntil;

      try {
        const eventsReceived = await new Promise<boolean>((resolve) => {
          const sub = subscribe(relays, [batchFilter]);
          let hasEvents = false;
          let resolved = false; // Flag to prevent double resolution
          
          const timeoutId = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              sub.unsub();
              resolve(hasEvents);
            }
          }, timeoutMs);

          sub.on("event", (evt: any) => {
            hasEvents = true;
            batchEvents.push(evt);
            if (evt.created_at < oldestInBatch) {
              oldestInBatch = evt.created_at;
            }
          });

          sub.on("eose", () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);
              sub.unsub();
              resolve(hasEvents);
            }
          });
        });

        // Process events in this batch
        for (const evt of batchEvents) {
          try {
            await onEvent(evt);
            stats.totalEvents++;
            
            // Track timestamp range (only update if we have valid events)
            if (evt.created_at && typeof evt.created_at === 'number') {
              if (stats.oldestTimestamp === 0 || evt.created_at < stats.oldestTimestamp) {
                stats.oldestTimestamp = evt.created_at;
              }
              if (evt.created_at > stats.latestTimestamp) {
                stats.latestTimestamp = evt.created_at;
              }
            }
          } catch (e) {
            logger.warn("处理事件失败", evt.id, e);
          }
        }

        stats.batchesFetched++;
        batchCount++;

        // Report progress
        if (onProgress) {
          onProgress({ ...stats, completed: false });
        }

        logger.info(`批次 #${batchCount} 完成: ${batchEvents.length} 个事件`);

        // Check if we should continue
        if (batchEvents.length === 0) {
          logger.info(`没有更多事件，停止回填`);
          break;
        }

        if (batchEvents.length < batchSize) {
          logger.info(`获取到的事件少于限制，可能已到末尾`);
          break;
        }

        // Move time window backward for next batch
        // Use oldest event timestamp - 1 as new until
        currentUntil = oldestInBatch - 1;

      } catch (e) {
        logger.error(`批次 #${batchCount + 1} 失败`, e);
        break;
      }
    }
  }

  stats.completed = true;
  
  logger.info(`回填完成: ${stats.totalEvents} 个事件, ${stats.batchesFetched} 个批次`);
  
  if (onComplete) {
    onComplete(stats);
  }

  return stats;
}

/**
 * Fetch friend lists (kind 3 or kind 30000) with batching
 * 
 * This is optimized for fetching contact/friend lists from multiple authors.
 * Since these are replaceable events, we only need the latest one per author.
 */
export async function backfillFriendLists(options: {
  relays: string[];
  authors: string[];
  kind?: number; // Default: 30000 (NIP-51 People List)
  dTag?: string; // For kind 30000, specify d tag (e.g., "close-friends")
  onEvent: (event: any) => Promise<void> | void;
  onProgress?: (fetched: number, total: number) => void;
  authorBatchSize?: number;
  timeoutMs?: number;
}): Promise<number> {
  const {
    relays,
    authors,
    kind = 30000,
    dTag,
    onEvent,
    onProgress,
    authorBatchSize = 50,
    timeoutMs = 10000
  } = options;

  const authorBatches = batchAuthors(authors, authorBatchSize);
  let totalFetched = 0;

  logger.info(`获取好友列表: ${authors.length} 个作者, ${authorBatches.length} 个批次`);

  for (let i = 0; i < authorBatches.length; i++) {
    const batch = authorBatches[i];
    
    const filter: any = {
      kinds: [kind],
      authors: batch,
      limit: batch.length // One per author max
    };

    // Add d tag for parameterized replaceable events (kind 30000-39999)
    if (kind >= 30000 && kind <= 39999 && dTag) {
      filter["#d"] = [dTag];
    }

    try {
      const batchEvents: any[] = [];
      
      await new Promise<void>((resolve) => {
        const sub = subscribe(relays, [filter]);
        const timeoutId = setTimeout(() => {
          sub.unsub();
          resolve();
        }, timeoutMs);

        sub.on("event", (evt: any) => {
          batchEvents.push(evt);
        });

        sub.on("eose", () => {
          clearTimeout(timeoutId);
          sub.unsub();
          resolve();
        });
      });

      // Process events
      for (const evt of batchEvents) {
        try {
          await onEvent(evt);
          totalFetched++;
        } catch (e) {
          logger.warn("处理好友列表事件失败", evt.id, e);
        }
      }

      if (onProgress) {
        onProgress(totalFetched, authors.length);
      }

      logger.info(`好友列表批次 ${i + 1}/${authorBatches.length}: ${batchEvents.length} 个事件`);

    } catch (e) {
      logger.error(`好友列表批次 ${i + 1} 失败`, e);
    }
  }

  logger.info(`好友列表获取完成: ${totalFetched} 个列表`);
  return totalFetched;
}

/**
 * Save breakpoint for incremental backfill
 */
export function saveBackfillBreakpoint(key: string, timestamp: number) {
  try {
    localStorage.setItem(`backfill_breakpoint_${key}`, String(timestamp));
  } catch (e) {
    logger.warn("保存回填断点失败", e);
  }
}

/**
 * Load breakpoint for incremental backfill
 */
export function loadBackfillBreakpoint(key: string): number | null {
  try {
    const raw = localStorage.getItem(`backfill_breakpoint_${key}`);
    if (raw) {
      const ts = parseInt(raw, 10);
      return isNaN(ts) ? null : ts;
    }
  } catch (e) {
    logger.warn("加载回填断点失败", e);
  }
  return null;
}
