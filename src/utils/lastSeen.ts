/**
 * Utility functions for managing the lastSeenCreatedAt watermark
 * This helps prevent showing the same "new messages" repeatedly on PWA cold starts
 */

const LAST_SEEN_PREFIX = 'home_lastSeenCreatedAt_';

/**
 * Get the lastSeenCreatedAt timestamp for a specific user
 * @param userPkHex - User's public key hex
 * @returns Unix timestamp in seconds, or 0 if not set
 */
export function getLastSeenCreatedAt(userPkHex: string): number {
  if (!userPkHex) return 0;
  
  try {
    const key = `${LAST_SEEN_PREFIX}${userPkHex}`;
    const value = localStorage.getItem(key);
    if (!value) return 0;
    
    const timestamp = parseInt(value, 10);
    return isNaN(timestamp) ? 0 : timestamp;
  } catch (e) {
    console.error('Failed to get lastSeenCreatedAt', e);
    return 0;
  }
}

/**
 * Set the lastSeenCreatedAt timestamp for a specific user
 * @param userPkHex - User's public key hex
 * @param timestamp - Unix timestamp in seconds
 */
export function setLastSeenCreatedAt(userPkHex: string, timestamp: number): void {
  if (!userPkHex || timestamp < 0) return;
  
  try {
    const key = `${LAST_SEEN_PREFIX}${userPkHex}`;
    localStorage.setItem(key, timestamp.toString());
  } catch (e) {
    console.error('Failed to set lastSeenCreatedAt', e);
  }
}

/**
 * Update lastSeenCreatedAt to the newest message timestamp in the given list
 * @param userPkHex - User's public key hex
 * @param messages - Array of messages with created_at property
 * @returns The newest timestamp that was set, or 0 if no valid messages
 */
export function updateLastSeenToNewest(userPkHex: string, messages: Array<{ created_at?: number }>): number {
  if (!userPkHex || !messages || messages.length === 0) return 0;
  
  const newestTimestamp = messages.reduce((max, msg) => {
    const ts = msg.created_at || 0;
    return ts > max ? ts : max;
  }, 0);
  
  if (newestTimestamp > 0) {
    setLastSeenCreatedAt(userPkHex, newestTimestamp);
  }
  
  return newestTimestamp;
}
