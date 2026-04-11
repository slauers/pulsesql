import type * as Monaco from 'monaco-editor';
import { ensureTablesCached } from '../database/metadata-cache';
import type { DatabaseEngine } from '../../store/connections';
import { useDatabaseSessionStore } from '../../store/databaseSession';

export function registerSqlAutocomplete(
  monaco: typeof Monaco,
  getContext: () => {
    connectionId?: string | null;
    activeSchema?: string | null;
    engine?: DatabaseEngine | null;
  },
) {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', '.', '_'],
    async provideCompletionItems(model, position) {
      const { connectionId, activeSchema, engine } = getContext();
      if (!connectionId) {
        return { suggestions: [] };
      }

      const contextWindow = getContextWindow(model, position, 240);
      const contextMatch = contextWindow.text.match(/(?:from|join)\s+([A-Za-z0-9_$."]*)$/i);
      if (!contextMatch) {
        return { suggestions: [] };
      }

      const typedToken = contextMatch[1] ?? '';
      const replaceStartColumn = Math.max(position.column - typedToken.length, contextWindow.startColumn);
      const tokenRange = {
        startLineNumber: position.lineNumber,
        startColumn: replaceStartColumn,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      };

      let candidates = getTableCandidates(connectionId, activeSchema, typedToken.includes('.'));
      if (!candidates.length && activeSchema && engine) {
        try {
          await ensureTablesCached(connectionId, engine, activeSchema);
          candidates = getTableCandidates(connectionId, activeSchema, typedToken.includes('.'));
        } catch {
          return { suggestions: [] };
        }
      }

      const normalizedToken = typedToken.toLowerCase();
      const suggestions = rankCandidates(candidates, normalizedToken)
        .slice(0, 80)
        .map((candidate, index) => buildSuggestion(monaco, candidate, tokenRange, index));

      return { suggestions };
    },
  });
}

export function isTableSuggestionContext(sqlBeforeCursor: string): boolean {
  return /(?:from|join)\s+([A-Za-z0-9_$."]*)$/i.test(sqlBeforeCursor);
}

function getContextWindow(model: Monaco.editor.ITextModel, position: Monaco.Position, maxChars: number) {
  const startColumn = Math.max(1, position.column - maxChars);
  const text = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  return {
    text,
    startColumn,
  };
}

function getTableCandidates(connectionId: string, activeSchema?: string | null, preferQualified = false): string[] {
  const metadata = useDatabaseSessionStore.getState().metadataByConnection[connectionId];
  if (!metadata) {
    return [];
  }

  const values: string[] = [];
  const seen = new Set<string>();

  const pushValue = (value: string) => {
    if (seen.has(value)) {
      return;
    }
    seen.add(value);
    values.push(value);
  };

  if (!preferQualified && activeSchema) {
    for (const table of metadata.schemasByName[activeSchema]?.tables ?? []) {
      pushValue(table);
    }

    return values;
  }

  for (const schemaName of metadata.schemas) {
    for (const table of metadata.schemasByName[schemaName]?.tables ?? []) {
      pushValue(preferQualified ? `${schemaName}.${table}` : schemaName === activeSchema ? table : `${schemaName}.${table}`);
    }
  }

  return values;
}

function rankCandidates(candidates: string[], normalizedToken: string): string[] {
  if (!normalizedToken) {
    return candidates;
  }

  return candidates
    .map((candidate) => {
      const normalizedCandidate = candidate.toLowerCase();
      const startsWith = normalizedCandidate.startsWith(normalizedToken);
      const afterSeparator = normalizedCandidate.includes(`.${normalizedToken}`) || normalizedCandidate.includes(`_${normalizedToken}`);
      const includes = normalizedCandidate.includes(normalizedToken);

      return {
        candidate,
        score: startsWith ? 0 : afterSeparator ? 1 : includes ? 2 : 3,
      };
    })
    .filter((entry) => entry.score < 3)
    .sort((left, right) => left.score - right.score || left.candidate.localeCompare(right.candidate))
    .map((entry) => entry.candidate);
}

function buildSuggestion(
  monaco: typeof Monaco,
  candidate: string,
  tokenRange: Monaco.IRange,
  index: number,
): Monaco.languages.CompletionItem {
  const [schemaName, tableName] = candidate.includes('.')
    ? candidate.split('.', 2)
    : [undefined, candidate];

  return {
    label: schemaName
      ? {
          label: tableName,
          description: schemaName,
        }
      : candidate,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: candidate,
    filterText: candidate,
    detail: schemaName ? `${schemaName}.${tableName}` : 'Tabela do schema ativo',
    range: tokenRange,
    sortText: `${String(index).padStart(2, '0')}-${candidate}`,
  };
}
