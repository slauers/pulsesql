import type * as Monaco from 'monaco-editor';
import { ensureColumnsCached, ensureSchemasCached, ensureTablesCached } from '../database/metadata-cache';
import type { DatabaseEngine } from '../../store/connections';
import { useDatabaseSessionStore } from '../../store/databaseSession';
import type { MetadataColumn, MetadataConnectionEntry } from '../database/types';

export function registerSqlAutocomplete(
  monaco: typeof Monaco,
  getContext: () => {
    connectionId?: string | null;
    activeSchema?: string | null;
    engine?: DatabaseEngine | null;
  },
) {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: [' ', '.', '_', ':'],
    async provideCompletionItems(model, position) {
      const { connectionId, activeSchema, engine } = getContext();
      if (!connectionId) {
        return { suggestions: [] };
      }

      const contextWindow = getContextWindow(model, position, 300);
      const textBefore = contextWindow.text;

      // Current statement: text from the last `;` before the cursor to the cursor.
      // This prevents FROM clauses in other queries from polluting completions.
      const textUpToCursor = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const lastSemicolon = textUpToCursor.lastIndexOf(';');
      const currentStatementBeforeCursor = textUpToCursor.slice(lastSemicolon + 1);
      const currentStatement = getCurrentStatement(model, position);

      // ── 1. alias.col pattern — e.g. "u.col|" or "users.col|" ────────────────
      const dotMatch = textBefore.match(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/);
      if (dotMatch) {
        const [, prefix, partialCol] = dotMatch;

        // Skip if prefix is a known schema (let table-completion handle it)
        const meta = useDatabaseSessionStore.getState().metadataByConnection[connectionId];
        const isKnownSchema = meta?.schemas.some(
          (s) => s.toLowerCase() === prefix.toLowerCase(),
        );

        if (!isKnownSchema && activeSchema) {
          const schemaToSearch = activeSchema;

          // Resolve alias → table name from current statement only
          const tableName = resolveAliasInQuery(currentStatement, prefix) ?? prefix;

          const tokenRange = buildRange(position, partialCol.length);

          // Try from in-memory cache first
          let columns = getColumnCandidatesForTable(
            connectionId,
            schemaToSearch,
            tableName,
            partialCol,
          );

          // If nothing found and we have an engine, try loading from cache/remote
          if (!columns.length && engine) {
            try {
              await ensureColumnsCached(connectionId, engine, schemaToSearch, tableName, { priority: true });
              columns = getColumnCandidatesForTable(
                connectionId,
                schemaToSearch,
                tableName,
                partialCol,
              );
            } catch {
              // ignore
            }
          }

          if (columns.length) {
            return {
              suggestions: columns
                .slice(0, 80)
                .map((col, i) => buildColumnSuggestion(monaco, col, prefix, tokenRange, i)),
            };
          }
        }
      }

      // ── 2. Table completions after SELECT ───────────────────────────────────
      const selectTableContext = detectSelectTableContext(currentStatementBeforeCursor);
      if (selectTableContext) {
        const typedToken = selectTableContext.typedToken;
        const tokenRange = {
          startLineNumber: position.lineNumber,
          startColumn: Math.max(
            1,
            position.column - selectTableContext.replaceLength,
          ),
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        };

        const candidates = await resolveTableCandidates(
          connectionId,
          engine,
          activeSchema,
          typedToken.includes('.'),
        );

        const normalizedToken = typedToken.toLowerCase();
        const suggestions = rankCandidates(candidates, normalizedToken)
          .slice(0, 80)
          .map((candidate, index) =>
            buildTableSuggestion(monaco, candidate, tokenRange, index, 'select-snippet'),
          );

        return { suggestions };
      }

      // ── 2. Table completions after FROM / JOIN ────────────────────────────────
      const fromMatch = textBefore.match(/(?:from|join)\s+([A-Za-z0-9_$."]*)$/i);
      if (fromMatch) {
        const typedToken = fromMatch[1] ?? '';
        const replaceStartColumn = Math.max(
          position.column - typedToken.length,
          contextWindow.startColumn,
        );
        const tokenRange = {
          startLineNumber: position.lineNumber,
          startColumn: replaceStartColumn,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        };

        const candidates = await resolveTableCandidates(
          connectionId,
          engine,
          activeSchema,
          typedToken.includes('.'),
        );

        const normalizedToken = typedToken.toLowerCase();
        const suggestions = rankCandidates(candidates, normalizedToken)
          .slice(0, 80)
          .map((candidate, index) =>
            buildTableSuggestion(monaco, candidate, tokenRange, index, 'table-ref'),
          );

        return { suggestions };
      }

      // ── 3. Column completions in SELECT / WHERE / ORDER BY / GROUP BY ─────────
      if (activeSchema) {
        const columnCtx = detectColumnContext(currentStatementBeforeCursor);
        if (columnCtx) {
          // Only suggest columns from tables in the current statement's FROM/JOIN clauses
          const queryTables = uniqueQueryTables(
            extractTablesFromQuery(currentStatement, activeSchema),
          ).slice(0, 4);
          if (queryTables.length > 0) {
            const typedToken = textBefore.match(/([A-Za-z0-9_]*)$/)?.[1] ?? '';
            const tokenRange = buildRange(position, typedToken.length);
            const lower = typedToken.toLowerCase();

            if (engine) {
              await ensureColumnsForTables(connectionId, engine, queryTables);
            }

            const seen = new Set<string>();
            const columns: MetadataColumn[] = [];
            for (const { schemaName, tableName } of queryTables) {
              for (const col of getColumnCandidatesForTable(connectionId, schemaName, tableName, '')) {
                const key = col.columnName.toLowerCase();
                if (!seen.has(key) && (!lower || key.startsWith(lower))) {
                  seen.add(key);
                  columns.push(col);
                }
              }
            }

            if (columns.length) {
              return {
                suggestions: columns
                  .slice(0, 80)
                  .map((col, i) => buildColumnSuggestion(monaco, col, undefined, tokenRange, i)),
              };
            }
          }
        }
      }

      return { suggestions: [] };
    },
  });
}

export function isTableSuggestionContext(sqlBeforeCursor: string): boolean {
  return /(?:from|join)\s+([A-Za-z0-9_$."]*)$/i.test(sqlBeforeCursor) ||
    detectSelectTableContext(sqlBeforeCursor) !== null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildRange(position: Monaco.Position, tokenLength: number): Monaco.IRange {
  return {
    startLineNumber: position.lineNumber,
    startColumn: Math.max(1, position.column - tokenLength),
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  };
}

function getContextWindow(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  maxChars: number,
) {
  const startColumn = Math.max(1, position.column - maxChars);
  const text = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });

  return { text, startColumn };
}

function getCurrentStatement(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): string {
  const fullText = model.getValue();
  const offset = model.getOffsetAt(position);
  const start = fullText.lastIndexOf(';', Math.max(0, offset - 1)) + 1;
  const nextSemicolon = fullText.indexOf(';', offset);
  const end = nextSemicolon >= 0 ? nextSemicolon : fullText.length;
  return fullText.slice(start, end);
}

function detectColumnContext(textBefore: string): boolean {
  // We're in a column context if the last SQL keyword is SELECT, WHERE, AND, OR,
  // ORDER BY, GROUP BY, HAVING, or SET — and we're not immediately after FROM/JOIN.
  return /\b(?:select|where|and\b|or\b|order\s+by|group\s+by|having|set)\s+(?:[^;]*)$/i.test(
    textBefore,
  ) && !/(?:from|join)\s+[A-Za-z0-9_$.]*$/i.test(textBefore);
}

function detectSelectTableContext(textBefore: string): {
  typedToken: string;
  replaceLength: number;
} | null {
  const lastSemicolon = textBefore.lastIndexOf(';');
  const statement = textBefore.slice(lastSemicolon + 1);
  const match = statement.match(/^\s*select(?:\s+([A-Za-z0-9_$."]*))?$/i);
  if (!match) {
    return null;
  }

  const typedToken = match[1] ?? '';
  const replaceLength = statement.length;
  return { typedToken, replaceLength };
}

function extractTablesFromQuery(
  fullText: string,
  activeSchema: string,
): Array<{ schemaName: string; tableName: string }> {
  const pattern = /\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_.]*)/gi;
  const results: Array<{ schemaName: string; tableName: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(fullText)) !== null) {
    const tableRef = match[1];
    const parts = tableRef.split('.');
    const tableName = parts[parts.length - 1] ?? tableRef;
    const schemaName = parts.length > 1 ? (parts[0] ?? activeSchema) : activeSchema;
    results.push({ schemaName, tableName });
  }

  return results;
}

function uniqueQueryTables(
  tables: Array<{ schemaName: string; tableName: string }>,
): Array<{ schemaName: string; tableName: string }> {
  const seen = new Set<string>();
  const unique: Array<{ schemaName: string; tableName: string }> = [];

  for (const table of tables) {
    const key = `${table.schemaName}.${table.tableName}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(table);
  }

  return unique;
}

async function ensureColumnsForTables(
  connectionId: string,
  engine: DatabaseEngine,
  tables: Array<{ schemaName: string; tableName: string }>,
) {
  await Promise.all(
    tables.map(({ schemaName, tableName }) =>
      ensureColumnsCached(connectionId, engine, schemaName, tableName, { priority: true }).catch(
        () => null,
      ),
    ),
  );
}

async function resolveTableCandidates(
  connectionId: string,
  engine: DatabaseEngine | null | undefined,
  activeSchema: string | null | undefined,
  preferQualified: boolean,
): Promise<string[]> {
  let candidates = getTableCandidates(connectionId, activeSchema, preferQualified);
  if (candidates.length || !engine) {
    return candidates;
  }

  try {
    const schemas = await ensureSchemasCached(connectionId, engine, { markActive: true });
    const schemaName =
      activeSchema ??
      useDatabaseSessionStore.getState().activeSchemaByConnection[connectionId] ??
      schemas[0] ??
      null;

    if (schemaName) {
      await ensureTablesCached(connectionId, engine, schemaName);
      candidates = getTableCandidates(connectionId, schemaName, preferQualified);
    }
  } catch {
    return [];
  }

  return candidates;
}

function resolveAliasInQuery(fullText: string, alias: string): string | null {
  // Match: FROM tableName [AS] alias  or  JOIN tableName [AS] alias
  const pattern = new RegExp(
    `\\b(?:from|join)\\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\\s+(?:as\\s+)?)(${alias})\\b`,
    'gi',
  );
  const match = pattern.exec(fullText);
  if (!match) {
    return null;
  }

  const tableRef = match[1];
  // Strip schema prefix if present (schema.table → table)
  const parts = tableRef.split('.');
  return parts[parts.length - 1] ?? null;
}

function getColumnCandidatesForTable(
  connectionId: string,
  schemaName: string,
  tableName: string,
  partial: string,
): MetadataColumn[] {
  const meta = useDatabaseSessionStore.getState().metadataByConnection[connectionId];
  const resolvedSchemaName = resolveSchemaName(meta, schemaName);
  const resolvedTableName = resolvedSchemaName
    ? resolveTableName(meta, resolvedSchemaName, tableName)
    : null;
  const cols =
    resolvedSchemaName && resolvedTableName
      ? meta?.schemasByName[resolvedSchemaName]?.tablesByName[resolvedTableName]?.columns ?? []
      : [];

  if (!partial) {
    return cols;
  }

  const lower = partial.toLowerCase();
  return cols.filter((col) => col.columnName.toLowerCase().startsWith(lower));
}

function getTableCandidates(
  connectionId: string,
  activeSchema?: string | null,
  preferQualified = false,
): string[] {
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
    const schemaName = resolveSchemaName(metadata, activeSchema);
    for (const table of schemaName ? metadata.schemasByName[schemaName]?.tables ?? [] : []) {
      pushValue(table);
    }

    if (values.length) {
      return values;
    }
  }

  const schemaNames = metadata.schemas.length
    ? metadata.schemas
    : Object.keys(metadata.schemasByName);

  for (const schemaName of schemaNames) {
    for (const table of metadata.schemasByName[schemaName]?.tables ?? []) {
      pushValue(
        preferQualified
          ? `${schemaName}.${table}`
          : schemaName === activeSchema
            ? table
            : `${schemaName}.${table}`,
      );
    }
  }

  return values;
}

function resolveSchemaName(
  metadata: MetadataConnectionEntry | undefined,
  schemaName: string,
): string | null {
  if (!metadata) {
    return null;
  }

  if (metadata.schemasByName[schemaName]) {
    return schemaName;
  }

  return Object.keys(metadata.schemasByName).find(
    (candidate) => candidate.toLowerCase() === schemaName.toLowerCase(),
  ) ?? null;
}

function resolveTableName(
  metadata: MetadataConnectionEntry,
  schemaName: string,
  tableName: string,
): string | null {
  const tablesByName = metadata.schemasByName[schemaName]?.tablesByName;
  if (!tablesByName) {
    return null;
  }

  if (tablesByName[tableName]) {
    return tableName;
  }

  return Object.keys(tablesByName).find(
    (candidate) => candidate.toLowerCase() === tableName.toLowerCase(),
  ) ?? null;
}

function rankCandidates(candidates: string[], normalizedToken: string): string[] {
  if (!normalizedToken) {
    return candidates;
  }

  return candidates
    .map((candidate) => {
      const normalizedCandidate = candidate.toLowerCase();
      const startsWith = normalizedCandidate.startsWith(normalizedToken);
      const afterSeparator =
        normalizedCandidate.includes(`.${normalizedToken}`) ||
        normalizedCandidate.includes(`_${normalizedToken}`);
      const includes = normalizedCandidate.includes(normalizedToken);

      return {
        candidate,
        score: startsWith ? 0 : afterSeparator ? 1 : includes ? 2 : 3,
      };
    })
    .filter((entry) => entry.score < 3)
    .sort(
      (left, right) =>
        left.score - right.score || left.candidate.localeCompare(right.candidate),
    )
    .map((entry) => entry.candidate);
}

function buildTableSuggestion(
  monaco: typeof Monaco,
  candidate: string,
  tokenRange: Monaco.IRange,
  index: number,
  mode: 'table-ref' | 'select-snippet',
): Monaco.languages.CompletionItem {
  const [schemaName, tableName] = candidate.includes('.')
    ? candidate.split('.', 2)
    : [undefined, candidate];

  return {
    label: schemaName
      ? { label: tableName, description: schemaName }
      : candidate,
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: mode === 'select-snippet'
      ? `SELECT \${1:*}\nFROM ${candidate}`
      : candidate,
    insertTextRules: mode === 'select-snippet'
      ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
      : undefined,
    filterText: mode === 'select-snippet' ? `select ${candidate}` : candidate,
    detail: schemaName ? `${schemaName}.${tableName}` : 'Tabela do schema ativo',
    range: tokenRange,
    sortText: `${String(index).padStart(2, '0')}-${candidate}`,
    command: mode === 'select-snippet'
      ? {
          id: 'editor.action.triggerSuggest',
          title: 'Sugerir colunas',
        }
      : undefined,
  };
}

function buildColumnSuggestion(
  monaco: typeof Monaco,
  column: MetadataColumn,
  tablePrefix: string | undefined,
  tokenRange: Monaco.IRange,
  index: number,
): Monaco.languages.CompletionItem {
  const typeBadge = column.isPrimaryKey ? ' 🔑' : column.isForeignKey ? ' 🔗' : '';
  return {
    label: {
      label: column.columnName,
      description: column.dataType + typeBadge,
    },
    kind: monaco.languages.CompletionItemKind.Field,
    insertText: column.columnName,
    filterText: tablePrefix
      ? `${tablePrefix}.${column.columnName}`
      : column.columnName,
    detail: `${column.dataType}${column.nullable === false ? ' NOT NULL' : ''}`,
    range: tokenRange,
    sortText: `${String(index).padStart(3, '0')}-${column.columnName}`,
  };
}
