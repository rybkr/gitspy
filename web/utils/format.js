/**
 * @fileoverview Formatting helpers for the Git visualization UI.
 * Provides reusable utilities to keep display logic consistent.
 */

/**
 * Returns a shortened commit hash suitable for labels and tooltips.
 *
 * @param {string} hash Full commit hash string.
 * @returns {string} Seven-character abbreviated hash when possible,
 * otherwise the original input.
 */
export function shortenHash(hash) {
    if (typeof hash !== "string") {
        return hash;
    }

    return hash.length >= 7 ? hash.slice(0, 7) : hash;
}

