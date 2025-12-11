/**
 * Utility functions for bunker (NIP-46) error handling
 */

/**
 * Check if an error is related to bunker/remote signer connection issues
 * 
 * Note: This function uses string matching which may have false positives.
 * Ideally, bunker implementation should provide specific error types/codes,
 * but for now we detect common patterns in error messages.
 * 
 * @param error - Error object or message
 * @returns true if this is a bunker-related error
 */
export function isBunkerError(error: any): boolean {
  const errorMsg = error?.message || String(error);
  return errorMsg.includes("Bunker") || 
         errorMsg.includes("bunker") ||
         errorMsg.includes("签名器") || 
         errorMsg.includes("超时") ||
         errorMsg.includes("操作超时") ||
         errorMsg.includes("timeout") ||
         errorMsg.includes("remote signer");
}

/**
 * Get a user-friendly error message for bunker errors
 * @param error - Error object or message
 * @returns User-friendly error message
 */
export function getBunkerErrorMessage(error: any): string {
  if (isBunkerError(error)) {
    return "远程签名器连接问题，请检查签名器是否在线或尝试重新连接";
  }
  return error?.message || String(error);
}
