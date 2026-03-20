import { execSync } from 'child_process';

/**
 * Aggregated git statistics for all files in a repository.
 * Collected in bulk via a small number of git commands for performance.
 */
export interface GitStats {
  /** Number of commits that touched each file (relative path → count) */
  changeFrequency: Record<string, number>;
  /** Files changed in the last N days (relative path → commit count in window) */
  recentActivity: Record<string, number>;
  /** Unique author count per file (relative path → count) */
  authorCount: Record<string, number>;
  /** Total lines added + removed per file (relative path → total churn) */
  churn: Record<string, number>;
}

export interface GitStatsOptions {
  /** Number of days for the "recent activity" window (default: 30) */
  recentDays?: number;
}

/**
 * Collect all git statistics for a repository in a small number of git commands.
 * Returns empty maps if the directory is not a git repo or git fails.
 */
export function collectGitStats(repoPath: string, options?: GitStatsOptions): GitStats {
  const recentDays = options?.recentDays ?? 30;
  const stats: GitStats = {
    changeFrequency: {},
    recentActivity: {},
    authorCount: {},
    churn: {},
  };

  try {
    // 1. Change frequency: count how often each file appears in commits
    const nameOnly = execGit(repoPath, 'log --format="" --name-only');
    for (const line of nameOnly.split('\n')) {
      const file = line.trim();
      if (!file) continue;
      stats.changeFrequency[file] = (stats.changeFrequency[file] ?? 0) + 1;
    }

    // 2. Recent activity: same but scoped to last N days
    const recentNameOnly = execGit(repoPath, `log --since="${recentDays} days ago" --format="" --name-only`);
    for (const line of recentNameOnly.split('\n')) {
      const file = line.trim();
      if (!file) continue;
      stats.recentActivity[file] = (stats.recentActivity[file] ?? 0) + 1;
    }

    // 3. Author count + Churn: parse numstat with author info
    // Use a format that gives us author email then numstat per commit
    const numstatLog = execGit(repoPath, 'log --format=">>>COMMIT<<<%ae" --numstat');
    let currentAuthor = '';
    for (const line of numstatLog.split('\n')) {
      if (line.startsWith('>>>COMMIT<<<')) {
        currentAuthor = line.slice('>>>COMMIT<<<'.length).trim();
        continue;
      }
      const parts = line.split('\t');
      if (parts.length !== 3) continue;
      const [added, deleted, file] = parts;
      if (!file || file.includes('=>')) continue; // skip renames
      const addedNum = parseInt(added, 10);
      const deletedNum = parseInt(deleted, 10);
      if (isNaN(addedNum) || isNaN(deletedNum)) continue; // binary files show '-'

      // Churn
      stats.churn[file] = (stats.churn[file] ?? 0) + addedNum + deletedNum;

      // Author count — track unique authors per file
      if (!stats.authorCount[file]) {
        // Initialize: we'll use a temporary structure, then flatten
        stats.authorCount[file] = 0;
      }
    }

    // For author count we need unique authors per file — rebuild from the log
    const authorMap: Record<string, Set<string>> = {};
    let curAuthor = '';
    for (const line of numstatLog.split('\n')) {
      if (line.startsWith('>>>COMMIT<<<')) {
        curAuthor = line.slice('>>>COMMIT<<<'.length).trim();
        continue;
      }
      const parts = line.split('\t');
      if (parts.length !== 3) continue;
      const file = parts[2];
      if (!file || file.includes('=>')) continue;
      if (!authorMap[file]) authorMap[file] = new Set();
      authorMap[file].add(curAuthor);
    }
    for (const [file, authors] of Object.entries(authorMap)) {
      stats.authorCount[file] = authors.size;
    }
  } catch {
    // Not a git repo or git not available — return empty stats
  }

  return stats;
}

function execGit(cwd: string, args: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
      timeout: 30_000, // 30 second timeout
    });
  } catch {
    return '';
  }
}
