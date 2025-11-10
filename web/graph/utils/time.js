/**
 * @fileoverview Time-related helpers for graph entities.
 * Provides utilities for parsing commit timestamps safely.
 */

/**
 * Returns the timestamp (ms) associated with a commit object.
 *
 * @param {import("../types.js").GraphCommit | undefined | null} commit Commit data structure.
 * @returns {number} Millisecond timestamp or 0 when unavailable.
 */
export function getCommitTimestamp(commit) {
	if (!commit) {
		return 0;
	}

	const when =
		commit.committer?.when ??
		commit.author?.when ??
		commit.committer?.When ??
		commit.author?.When;
	const time = new Date(when ?? 0).getTime();
	if (!Number.isFinite(time) || Number.isNaN(time)) {
		return 0;
	}
	return time;
}

