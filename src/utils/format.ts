import { nip19 } from 'nostr-tools';

/**
 * Convert npub or hex key to hex format
 * @param key - npub or hex key
 * @returns hex key or null if invalid
 */
export function keyToHex(key: string): string | null {
  if (!key) return null;
  
  const trimmed = key.trim();
  
  // If it's already a hex key (64 characters, hex format)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  
  // Try to decode as npub
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') {
        return decoded.data as string;
      }
    } catch (e) {
      return null;
    }
  }
  
  return null;
}

/**
 * Format timestamp to relative time
 * @param timestamp - Unix timestamp in seconds
 * @returns Relative time string (刚刚, X分钟前, X小时前, X天前)
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  
  if (diff < 60) {
    return '刚刚';
  }
  
  if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return `${minutes}分钟前`;
  }
  
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `${hours}小时前`;
  }
  
  const days = Math.floor(diff / 86400);
  return `${days}天前`;
}
