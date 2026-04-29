export interface RankableSqlCandidate {
  isActiveSchema?: boolean;
  qualifiedName: string;
  sourceOrder: number;
  tableName: string;
}

export function rankSqlTableCandidates<T extends RankableSqlCandidate>(
  candidates: T[],
  typedToken: string,
): T[] {
  const normalizedToken = normalizeSearchValue(typedToken);

  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreTableCandidate(candidate, normalizedToken),
    }))
    .filter((entry) => entry.score < Number.POSITIVE_INFINITY)
    .sort((left, right) => {
      const activeSchemaDelta = Number(!left.candidate.isActiveSchema) - Number(!right.candidate.isActiveSchema);
      return (
        left.score - right.score ||
        activeSchemaDelta ||
        left.candidate.sourceOrder - right.candidate.sourceOrder ||
        left.candidate.qualifiedName.localeCompare(right.candidate.qualifiedName)
      );
    })
    .map((entry) => entry.candidate);
}

export function makeSortText(bucket: number, index: number, label: string): string {
  return `${String(bucket).padStart(2, '0')}_${String(index).padStart(4, '0')}_${label.toLowerCase()}`;
}

function scoreTableCandidate(candidate: RankableSqlCandidate, normalizedToken: string): number {
  if (!normalizedToken) {
    return 0;
  }

  const tableName = normalizeSearchValue(candidate.tableName);
  const qualifiedName = normalizeSearchValue(candidate.qualifiedName);
  const activePenalty = candidate.isActiveSchema ? 0 : 20;
  const segmentStartIndex = findSegmentStartIndex(tableName, normalizedToken);
  const tableIncludesIndex = tableName.indexOf(normalizedToken);
  const qualifiedIncludesIndex = qualifiedName.indexOf(normalizedToken);

  if (tableName.startsWith(normalizedToken)) {
    return activePenalty;
  }

  if (qualifiedName.startsWith(normalizedToken)) {
    return activePenalty + 1;
  }

  if (segmentStartIndex >= 0) {
    return activePenalty + 2 + Math.min(segmentStartIndex, 50) / 100;
  }

  if (qualifiedName.includes(`.${normalizedToken}`)) {
    return activePenalty + 3;
  }

  if (tableIncludesIndex >= 0) {
    return activePenalty + 4 + Math.min(tableIncludesIndex, 50) / 100;
  }

  if (qualifiedIncludesIndex >= 0) {
    return activePenalty + 5 + Math.min(qualifiedIncludesIndex, 50) / 100;
  }

  return Number.POSITIVE_INFINITY;
}

function normalizeSearchValue(value: string): string {
  return value.trim().replace(/^["`]+|["`]+$/g, '').toLowerCase();
}

function findSegmentStartIndex(value: string, token: string): number {
  const pattern = new RegExp(`(?:^|[_.$])${escapeRegExp(token)}`);
  const match = pattern.exec(value);
  if (!match) {
    return -1;
  }

  return match[0].startsWith(token) ? match.index : match.index + 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
