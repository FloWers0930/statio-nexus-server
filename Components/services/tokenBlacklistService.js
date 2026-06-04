// backend/src/services/tokenBlacklistService.js
// Token blacklist service - tracks invalidated refresh tokens
// In production, use Redis instead of in-memory storage

class TokenBlacklistService {
  constructor() {
    // In-memory blacklist: token -> expirationTime
    // TODO: Replace with Redis for production
    this.blacklist = new Map();

    // Cleanup interval: remove expired tokens every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Add a token to the blacklist
   * @param {string} token - The JWT token to blacklist
   * @param {number} expiresAt - Unix timestamp when token expires
   */
  add(token, expiresAt) {
    this.blacklist.set(token, expiresAt);
  }

  /**
   * Check if a token is blacklisted
   * @param {string} token - The JWT token to check
   * @returns {boolean} - True if token is blacklisted, false otherwise
   */
  isBlacklisted(token) {
    if (!this.blacklist.has(token)) {
      return false;
    }

    const expiresAt = this.blacklist.get(token);
    const now = Math.floor(Date.now() / 1000);

    // Token has expired - remove it
    if (now >= expiresAt) {
      this.blacklist.delete(token);
      return false;
    }

    return true;
  }

  /**
   * Remove expired tokens from blacklist
   */
  cleanup() {
    const now = Math.floor(Date.now() / 1000);
    for (const [token, expiresAt] of this.blacklist) {
      if (now >= expiresAt) {
        this.blacklist.delete(token);
      }
    }
  }

  /**
   * Clear entire blacklist (for testing)
   */
  clear() {
    this.blacklist.clear();
  }

  /**
   * Get current blacklist size
   */
  size() {
    return this.blacklist.size;
  }

  /**
   * Destroy service and cleanup intervals
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.blacklist.clear();
  }
}

// Export singleton instance
module.exports = new TokenBlacklistService();
