import type { DatabaseEngine } from '../../store/connections';
import type { MetadataConnectionEntry } from '../database/types';

export interface MissingObjectMatch {
  kind: 'table';
  objectName: string | null;
  rawMessage: string;
}

export interface TableSuggestion {
  tableName: string;
  schemaName?: string | null;
  score: number;
}

export interface QueryErrorPresentation {
  title: string;
  summary: string;
  technicalMessage: string;
  suggestions: TableSuggestion[];
  explorerTarget?: {
    schemaName?: string | null;
    tableName: string;
  } | null;
}

export function buildQueryErrorPresentation(params: {
  error: unknown;
  engine?: DatabaseEngine;
  statement?: string | null;
  activeSchema?: string | null;
  metadataConnection?: MetadataConnectionEntry;
}): QueryErrorPresentation {
  const technicalMessage = extractErrorMessage(params.error).trim() || 'Erro desconhecido ao executar a query.';
  const lower = technicalMessage.toLowerCase();
  const missingObject = detectMissingTableError(technicalMessage, params.statement);
  const suggestions =
    missingObject?.objectName && params.metadataConnection
      ? suggestSimilarTables(missingObject.objectName, params.metadataConnection, params.activeSchema)
      : [];

  if (lower.includes('connection not found')) {
    return {
      title: 'Falha ao executar a query',
      summary: 'A conexão ativa não está disponível. Abra ou reconecte antes de executar a query.',
      technicalMessage,
      suggestions: [],
    };
  }

  if (lower.includes('timed out')) {
    return {
      title: 'Falha ao executar a query',
      summary: 'A query excedeu o tempo limite configurado.',
      technicalMessage,
      suggestions: [],
    };
  }

  if (lower.includes('ora-00933')) {
    return {
      title: 'Falha ao executar a query',
      summary: 'O Oracle informou que o comando SQL não foi encerrado adequadamente.',
      technicalMessage,
      suggestions: [],
    };
  }

  if (lower.includes('ora-01017')) {
    return {
      title: 'Falha ao executar a query',
      summary: 'Usuário ou senha inválidos no Oracle.',
      technicalMessage,
      suggestions: [],
    };
  }

  if (lower.includes('permission denied') || lower.includes('not authorized')) {
    return {
      title: 'Falha ao executar a query',
      summary: 'Permissão insuficiente para executar esta operação.',
      technicalMessage,
      suggestions: [],
    };
  }

  if (missingObject) {
    const summaryObjectName = missingObject.objectName ?? 'o objeto informado';

    return {
      title: 'Falha ao executar a query',
      summary: `Tabela "${summaryObjectName}" não encontrada.`,
      technicalMessage,
      suggestions,
      explorerTarget: suggestions[0]
        ? {
            schemaName: suggestions[0].schemaName ?? params.activeSchema ?? null,
            tableName: suggestions[0].tableName,
          }
        : null,
    };
  }

  return {
    title: 'Falha ao executar a query',
    summary: summarizeFallbackError(params.engine),
    technicalMessage,
    suggestions: [],
  };
}

export function detectMissingTableError(
  rawMessage: string,
  statement?: string | null,
): MissingObjectMatch | null {
  const normalized = rawMessage.trim();
  const lower = normalized.toLowerCase();

  if (lower.includes('does not exist')) {
    const relationMatch = normalized.match(/relation\s+"([^"]+)"/i) ?? normalized.match(/relation\s+'([^']+)'/i);
    if (relationMatch?.[1]) {
      return {
        kind: 'table',
        objectName: stripSchemaPrefix(relationMatch[1]),
        rawMessage: normalized,
      };
    }
  }

  if (lower.includes('ora-00942')) {
    const doubleQuotedMatches = normalized.match(/"([^"]+)"/g);
    const singleQuotedMatches = normalized.match(/'([^']+)'/g);
    const quotedObject =
      (doubleQuotedMatches ? doubleQuotedMatches[doubleQuotedMatches.length - 1]?.replace(/"/g, '') : null) ??
      (singleQuotedMatches ? singleQuotedMatches[singleQuotedMatches.length - 1]?.replace(/'/g, '') : null);

    const fallbackFromStatement = extractObjectNameFromStatement(statement);
    return {
      kind: 'table',
      objectName: stripSchemaPrefix(quotedObject ?? fallbackFromStatement),
      rawMessage: normalized,
    };
  }

  return null;
}

export function suggestSimilarTables(
  inputName: string,
  metadataConnection: MetadataConnectionEntry,
  activeSchema?: string | null,
): TableSuggestion[] {
  const normalizedInput = normalizeName(inputName);
  if (!normalizedInput) {
    return [];
  }

  const ranked = collectCandidateTables(metadataConnection, activeSchema)
    .map((candidate) => ({
      ...candidate,
      score: scoreTableCandidate(normalizedInput, normalizeName(candidate.tableName)),
    }))
    .filter((candidate) => candidate.score > 0.38)
    .sort((left, right) => right.score - left.score || left.tableName.localeCompare(right.tableName));

  const top = ranked.slice(0, 3);
  const seen = new Set<string>();
  return top.filter((item) => {
    const key = `${item.schemaName ?? ''}.${item.tableName}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    if ('toString' in error && typeof error.toString === 'function') {
      const asString = error.toString();
      if (asString && asString !== '[object Object]') {
        return asString;
      }
    }
  }

  return 'Erro desconhecido ao executar a query.';
}

function summarizeFallbackError(engine?: DatabaseEngine) {
  if (engine === 'oracle') {
    return 'O Oracle retornou um erro ao executar a query.';
  }

  if (engine === 'postgres') {
    return 'O PostgreSQL retornou um erro ao executar a query.';
  }

  return 'O banco retornou um erro ao executar a query.';
}

function collectCandidateTables(metadataConnection: MetadataConnectionEntry, activeSchema?: string | null) {
  const candidates: Array<{ tableName: string; schemaName?: string | null }> = [];
  const seen = new Set<string>();

  const pushSchemaTables = (schemaName: string) => {
    const schemaEntry = metadataConnection.schemasByName[schemaName];
    if (!schemaEntry) {
      return;
    }

    for (const tableName of schemaEntry.tables) {
      const key = `${schemaName}.${tableName}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({ tableName, schemaName });
    }
  };

  if (activeSchema) {
    pushSchemaTables(activeSchema);
  }

  for (const schemaName of metadataConnection.schemas) {
    if (schemaName === activeSchema) {
      continue;
    }
    pushSchemaTables(schemaName);
  }

  return candidates;
}

function scoreTableCandidate(input: string, candidate: string) {
  if (!input || !candidate) {
    return 0;
  }

  if (input === candidate) {
    return 1;
  }

  const prefixScore = candidate.startsWith(input) || input.startsWith(candidate) ? 0.92 : 0;
  const tokenScore = candidate.includes(input) || input.includes(candidate) ? 0.82 : 0;
  const singularScore = normalizePlural(input) === normalizePlural(candidate) ? 0.88 : 0;
  const distance = levenshtein(input, candidate);
  const maxLength = Math.max(input.length, candidate.length);
  const similarityScore = maxLength ? 1 - distance / maxLength : 0;

  return Math.max(prefixScore, tokenScore, singularScore, similarityScore);
}

function normalizePlural(value: string) {
  return value.endsWith('s') ? value.slice(0, -1) : value;
}

function normalizeName(value: string) {
  return value
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function stripSchemaPrefix(value?: string | null) {
  if (!value) {
    return null;
  }

  const parts = value.split('.');
  const target = parts[parts.length - 1] ?? value;
  return target.replace(/^"|"$/g, '');
}

function extractObjectNameFromStatement(statement?: string | null) {
  if (!statement) {
    return null;
  }

  const normalized = statement
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = normalized.match(
    /\b(?:from|join|update|into)\s+((?:"[^"]+"|[a-zA-Z0-9_$#]+)(?:\.(?:"[^"]+"|[a-zA-Z0-9_$#]+))?)/i,
  );

  if (!match?.[1]) {
    return null;
  }

  return stripSchemaPrefix(match[1]);
}

function levenshtein(left: string, right: string) {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }

  for (let col = 0; col < cols; col += 1) {
    matrix[0][col] = col;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}
