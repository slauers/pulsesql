import type * as Monaco from 'monaco-editor';
import type { DatabaseEngine } from '../../../store/connections';
import { useDatabaseSessionStore } from '../../../store/databaseSession';
import type { MetadataColumn, MetadataConnectionEntry } from '../../database/types';
import {
  getSqlAutocompleteContext,
  type SqlAutocompleteContext,
} from './sqlAutocompleteContext';
import type { ParsedSqlAliases, SqlTableReference } from './sqlAliasParser';
import { makeSortText, rankSqlTableCandidates, type RankableSqlCandidate } from './sqlAutocompleteRanking';
import { SELECT_FROM_TABLE_SNIPPET, SQL_KEYWORDS } from './sqlSnippets';

interface SqlAutocompleteRuntimeContext {
  connectionId?: string | null;
  activeSchema?: string | null;
  engine?: DatabaseEngine | null;
}

interface BuildSuggestionsParams {
  activeSchema?: string | null;
  completionContext?: Monaco.languages.CompletionContext;
  metadata?: MetadataConnectionEntry;
}

interface SqlTableCandidate extends RankableSqlCandidate {
  insertText: string;
  schemaName: string;
}

interface ResolvedTableReference {
  schemaName: string;
  tableName: string;
}

export function registerSqlAutocomplete(
  monaco: typeof Monaco,
  getContext: () => SqlAutocompleteRuntimeContext,
) {
  return monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.', ' ', '\n', '_'],
    provideCompletionItems(model, position, completionContext) {
      const startedAt = performance.now();
      const runtimeContext = getContext();
      const metadata = runtimeContext.connectionId
        ? useDatabaseSessionStore.getState().metadataByConnection[runtimeContext.connectionId]
        : undefined;
      const activeSchema = resolveActiveSchema(
        metadata,
        runtimeContext.connectionId,
        runtimeContext.activeSchema,
      );
      const sqlContext = getSqlAutocompleteContext(model, position);
      const suggestions = buildSuggestions(monaco, sqlContext, {
        activeSchema,
        completionContext,
        metadata,
      });

      logAutocompleteDebug(sqlContext, suggestions.length, performance.now() - startedAt);

      return {
        suggestions,
        incomplete: shouldRequeryAutocomplete(sqlContext),
      };
    },
  });
}

export function buildSuggestions(
  monaco: typeof Monaco,
  context: SqlAutocompleteContext,
  params: BuildSuggestionsParams = {},
): Monaco.languages.CompletionItem[] {
  switch (context.kind) {
    case 'afterSelectKeyword':
      return buildAfterSelectSuggestions(monaco, context, params);
    case 'afterFromKeyword':
    case 'afterJoinKeyword':
      return buildTableReferenceSuggestions(monaco, context, params);
    case 'afterDot':
      return buildDotColumnSuggestions(monaco, context, params);
    case 'afterWhereKeyword':
    case 'afterOrderByKeyword':
    case 'afterGroupByKeyword':
    case 'selectWithFrom':
      return buildStatementColumnSuggestions(monaco, context, params);
    case 'generic':
      return buildGenericSuggestions(monaco, context, params);
    default:
      return [];
  }
}

export function getColumnsForAlias(
  alias: string,
  metadata: MetadataConnectionEntry | undefined,
  activeSchema: string | null | undefined,
  aliases: ParsedSqlAliases,
): Array<{ column: MetadataColumn; tableLabel: string }> {
  return getColumnsForObjectRef(alias, metadata, activeSchema, aliases);
}

function buildAfterSelectSuggestions(
  monaco: typeof Monaco,
  context: SqlAutocompleteContext,
  params: BuildSuggestionsParams,
): Monaco.languages.CompletionItem[] {
  const tableCandidates = rankSqlTableCandidates(
    collectTableCandidates(params.metadata, params.activeSchema, false),
    context.typedToken,
  );

  if (tableCandidates.length) {
    const filterText = context.typedToken || 'select';
    return tableCandidates
      .slice(0, 80)
      .map((candidate, index) =>
        buildConcreteSelectSuggestion(monaco, candidate, context.selectTemplateRange, index, filterText),
      );
  }

  const suggestions: Monaco.languages.CompletionItem[] = [
    buildSelectTemplateSuggestion(monaco, context.selectTemplateRange),
    ...buildKeywordSuggestions(monaco, context.wordRange, 80),
  ];

  return dedupeSuggestions(suggestions);
}

function buildTableReferenceSuggestions(
  monaco: typeof Monaco,
  context: SqlAutocompleteContext,
  params: BuildSuggestionsParams,
): Monaco.languages.CompletionItem[] {
  const preferQualified = context.typedToken.includes('.');
  const tableCandidates = rankSqlTableCandidates(
    collectTableCandidates(params.metadata, params.activeSchema, preferQualified),
    context.typedToken,
  );

  if (!tableCandidates.length) {
    return isManualTrigger(monaco, params)
      ? buildKeywordSuggestions(monaco, context.replacementRange, 80)
      : [];
  }

  const suggestionLimit = context.typedToken ? 200 : 80;

  return tableCandidates
    .slice(0, suggestionLimit)
    .map((candidate, index) =>
      buildTableSuggestion(monaco, candidate, context.replacementRange, index, context.typedToken),
    );
}

function buildDotColumnSuggestions(
  monaco: typeof Monaco,
  context: SqlAutocompleteContext,
  params: BuildSuggestionsParams,
): Monaco.languages.CompletionItem[] {
  const columns = getColumnsForObjectRef(
    context.dotObject ?? '',
    params.metadata,
    params.activeSchema,
    context.aliases,
  );
  const normalizedPartial = context.dotPartial?.toLowerCase() ?? '';

  return columns
    .filter(({ column }) =>
      normalizedPartial
        ? column.columnName.toLowerCase().startsWith(normalizedPartial)
        : true,
    )
    .slice(0, 80)
    .map(({ column, tableLabel }, index) =>
      buildColumnSuggestion(monaco, column, tableLabel, context.replacementRange, index),
    );
}

function buildStatementColumnSuggestions(
  monaco: typeof Monaco,
  context: SqlAutocompleteContext,
  params: BuildSuggestionsParams,
): Monaco.languages.CompletionItem[] {
  const columns = collectStatementColumns(params.metadata, params.activeSchema, context.aliases);
  const normalizedToken = context.typedToken.toLowerCase();
  const seen = new Set<string>();
  const columnSuggestions = columns
    .filter(({ column }) => {
      const key = column.columnName.toLowerCase();
      if (seen.has(key)) {
        return false;
      }

      if (normalizedToken && !key.startsWith(normalizedToken)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 80)
    .map(({ column, tableLabel }, index) =>
      buildColumnSuggestion(monaco, column, tableLabel, context.replacementRange, index),
    );

  return dedupeSuggestions([
    ...columnSuggestions,
    ...buildKeywordSuggestions(monaco, context.replacementRange, 80),
  ]);
}

function buildGenericSuggestions(
  monaco: typeof Monaco,
  context: SqlAutocompleteContext,
  params: BuildSuggestionsParams,
): Monaco.languages.CompletionItem[] {
  const typedToken = context.typedToken.trim();

  if (!isManualTrigger(monaco, params) && typedToken.length < 2) {
    return [];
  }

  const tableSuggestions = rankSqlTableCandidates(
    collectTableCandidates(params.metadata, params.activeSchema, false),
    typedToken,
  )
    .slice(0, 40)
    .map((candidate, index) =>
      buildTableSuggestion(monaco, candidate, context.replacementRange, index, typedToken),
    );

  return dedupeSuggestions([
    ...tableSuggestions,
    ...buildKeywordSuggestions(monaco, context.replacementRange, 80),
  ]);
}

function isManualTrigger(
  monaco: typeof Monaco,
  params: BuildSuggestionsParams,
): boolean {
  return params.completionContext?.triggerKind === monaco.languages.CompletionTriggerKind.Invoke;
}

function shouldRequeryAutocomplete(context: SqlAutocompleteContext): boolean {
  return (
    context.kind === 'afterFromKeyword' ||
    context.kind === 'afterJoinKeyword' ||
    context.kind === 'afterSelectKeyword' ||
    context.kind === 'generic'
  );
}

function collectTableCandidates(
  metadata: MetadataConnectionEntry | undefined,
  activeSchema: string | null | undefined,
  preferQualified: boolean,
): SqlTableCandidate[] {
  if (!metadata) {
    return [];
  }

  const candidates: SqlTableCandidate[] = [];
  const seen = new Set<string>();
  const resolvedActiveSchema = resolveSchemaName(metadata, activeSchema);
  const schemaNames = metadata.schemas.length ? metadata.schemas : Object.keys(metadata.schemasByName);

  const pushTables = (schemaName: string, isActiveSchema: boolean) => {
    const schemaEntry = metadata.schemasByName[schemaName];
    if (!schemaEntry) {
      return;
    }

    for (const tableName of schemaEntry.tables) {
      const qualifiedName = `${schemaName}.${tableName}`;
      const key = preferQualified
        ? qualifiedName.toLowerCase()
        : tableName.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push({
        insertText: preferQualified ? qualifiedName : tableName,
        isActiveSchema,
        qualifiedName,
        schemaName,
        sourceOrder: candidates.length,
        tableName,
      });
    }
  };

  if (resolvedActiveSchema) {
    pushTables(resolvedActiveSchema, true);
  }

  for (const schemaName of schemaNames) {
    if (schemaName === resolvedActiveSchema) {
      continue;
    }

    pushTables(schemaName, false);
  }

  return candidates;
}

function collectStatementColumns(
  metadata: MetadataConnectionEntry | undefined,
  activeSchema: string | null | undefined,
  aliases: ParsedSqlAliases,
): Array<{ column: MetadataColumn; tableLabel: string }> {
  return aliases.tables
    .slice(0, 6)
    .flatMap((tableRef) => getColumnsForTableReference(tableRef, metadata, activeSchema));
}

function getColumnsForObjectRef(
  objectRef: string,
  metadata: MetadataConnectionEntry | undefined,
  activeSchema: string | null | undefined,
  aliases: ParsedSqlAliases,
): Array<{ column: MetadataColumn; tableLabel: string }> {
  if (!metadata || !objectRef) {
    return [];
  }

  const aliasTarget = aliases.aliases.get(objectRef.toLowerCase());
  if (aliasTarget) {
    return getColumnsForTableReference(aliasTarget, metadata, activeSchema);
  }

  const directTable = resolveObjectRefAsTable(metadata, activeSchema, objectRef);
  if (!directTable) {
    return [];
  }

  return getColumnsForResolvedTable(metadata, directTable);
}

function getColumnsForTableReference(
  tableRef: SqlTableReference,
  metadata: MetadataConnectionEntry | undefined,
  activeSchema: string | null | undefined,
): Array<{ column: MetadataColumn; tableLabel: string }> {
  if (!metadata) {
    return [];
  }

  const resolvedSchema = resolveSchemaName(metadata, tableRef.schemaName ?? activeSchema);
  if (resolvedSchema) {
    const resolvedTable = resolveTableName(metadata, resolvedSchema, tableRef.tableName);
    if (resolvedTable) {
      return getColumnsForResolvedTable(metadata, {
        schemaName: resolvedSchema,
        tableName: resolvedTable,
      });
    }
  }

  const fallbackTable = resolveObjectRefAsTable(metadata, activeSchema, tableRef.tableName);
  return fallbackTable ? getColumnsForResolvedTable(metadata, fallbackTable) : [];
}

function getColumnsForResolvedTable(
  metadata: MetadataConnectionEntry,
  table: ResolvedTableReference,
): Array<{ column: MetadataColumn; tableLabel: string }> {
  const columns =
    metadata.schemasByName[table.schemaName]?.tablesByName[table.tableName]?.columns ?? [];
  const tableLabel = `${table.schemaName}.${table.tableName}`;

  return columns.map((column) => ({ column, tableLabel }));
}

function resolveObjectRefAsTable(
  metadata: MetadataConnectionEntry,
  activeSchema: string | null | undefined,
  objectRef: string,
): ResolvedTableReference | null {
  const parts = objectRef.split('.');

  if (parts.length >= 2) {
    const schemaName = resolveSchemaName(metadata, parts[parts.length - 2]);
    if (!schemaName) {
      return null;
    }

    const tableName = resolveTableName(metadata, schemaName, parts[parts.length - 1] ?? '');
    return tableName ? { schemaName, tableName } : null;
  }

  const activeSchemaName = resolveSchemaName(metadata, activeSchema);
  if (activeSchemaName) {
    const activeTableName = resolveTableName(metadata, activeSchemaName, objectRef);
    if (activeTableName) {
      return { schemaName: activeSchemaName, tableName: activeTableName };
    }
  }

  for (const schemaName of metadata.schemas.length ? metadata.schemas : Object.keys(metadata.schemasByName)) {
    const tableName = resolveTableName(metadata, schemaName, objectRef);
    if (tableName) {
      return { schemaName, tableName };
    }
  }

  return null;
}

function buildSelectTemplateSuggestion(
  monaco: typeof Monaco,
  range: Monaco.IRange,
): Monaco.languages.CompletionItem {
  return {
    label: SELECT_FROM_TABLE_SNIPPET.label,
    kind: monaco.languages.CompletionItemKind.Snippet,
    detail: SELECT_FROM_TABLE_SNIPPET.detail,
    filterText: 'select',
    insertText: SELECT_FROM_TABLE_SNIPPET.insertText,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
    sortText: '00_select_template',
  };
}

function buildConcreteSelectSuggestion(
  monaco: typeof Monaco,
  candidate: SqlTableCandidate,
  range: Monaco.IRange,
  index: number,
  typedToken: string,
): Monaco.languages.CompletionItem {
  return {
    label: {
      label: candidate.tableName,
      description: candidate.schemaName,
    },
    kind: monaco.languages.CompletionItemKind.Struct,
    detail: `SELECT * FROM ${candidate.insertText}`,
    filterText: typedToken || candidate.tableName,
    insertText: `SELECT * FROM ${candidate.insertText};`,
    range,
    sortText: makeSortText(1, index, candidate.qualifiedName),
  };
}

function buildTableSuggestion(
  monaco: typeof Monaco,
  candidate: SqlTableCandidate,
  range: Monaco.IRange,
  index: number,
  typedToken: string,
): Monaco.languages.CompletionItem {
  return {
    label: {
      label: candidate.tableName,
      description: candidate.schemaName,
    },
    kind: monaco.languages.CompletionItemKind.Struct,
    detail: `table - ${candidate.schemaName}`,
    filterText: typedToken || candidate.tableName,
    insertText: candidate.insertText,
    range,
    sortText: makeSortText(candidate.isActiveSchema ? 20 : 90, index, candidate.qualifiedName),
  };
}

function buildColumnSuggestion(
  monaco: typeof Monaco,
  column: MetadataColumn,
  tableLabel: string,
  range: Monaco.IRange,
  index: number,
): Monaco.languages.CompletionItem {
  return {
    label: {
      label: column.columnName,
      description: column.dataType,
    },
    kind: monaco.languages.CompletionItemKind.Field,
    detail: `${column.dataType}${column.nullable === false ? ' NOT NULL' : ''} - ${tableLabel}`,
    filterText: column.columnName,
    insertText: column.columnName,
    range,
    sortText: makeSortText(10, index, column.columnName),
  };
}

function buildKeywordSuggestions(
  monaco: typeof Monaco,
  range: Monaco.IRange,
  bucket: number,
): Monaco.languages.CompletionItem[] {
  return SQL_KEYWORDS.map((keyword, index) => ({
    label: keyword.label,
    kind: monaco.languages.CompletionItemKind.Keyword,
    detail: 'SQL keyword',
    insertText: keyword.insertText,
    range,
    sortText: makeSortText(bucket, index, keyword.label),
  }));
}

function dedupeSuggestions(
  suggestions: Monaco.languages.CompletionItem[],
): Monaco.languages.CompletionItem[] {
  const seen = new Set<string>();
  const unique: Monaco.languages.CompletionItem[] = [];

  for (const suggestion of suggestions) {
    const key = `${labelToString(suggestion.label)}:${suggestion.detail ?? ''}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(suggestion);
  }

  return unique;
}

function labelToString(label: Monaco.languages.CompletionItem['label']): string {
  return typeof label === 'string' ? label : label.label;
}

function resolveActiveSchema(
  metadata: MetadataConnectionEntry | undefined,
  connectionId: string | null | undefined,
  activeSchema: string | null | undefined,
): string | null {
  const schemaName =
    activeSchema ??
    (connectionId ? useDatabaseSessionStore.getState().activeSchemaByConnection[connectionId] : null);

  return resolveSchemaName(metadata, schemaName);
}

function resolveSchemaName(
  metadata: MetadataConnectionEntry | undefined,
  schemaName: string | null | undefined,
): string | null {
  if (!metadata || !schemaName) {
    return null;
  }

  if (metadata.schemasByName[schemaName]) {
    return schemaName;
  }

  return (
    Object.keys(metadata.schemasByName).find(
      (candidate) => candidate.toLowerCase() === schemaName.toLowerCase(),
    ) ?? null
  );
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

  return (
    Object.keys(tablesByName).find(
      (candidate) => candidate.toLowerCase() === tableName.toLowerCase(),
    ) ?? null
  );
}

function logAutocompleteDebug(
  context: SqlAutocompleteContext,
  suggestionCount: number,
  durationMs: number,
) {
  if (!isAutocompleteDebugEnabled()) {
    return;
  }

  console.debug('[PulseSQL autocomplete]', {
    context: context.kind,
    durationMs: Math.round(durationMs),
    suggestions: suggestionCount,
    typedToken: context.typedToken,
  });
}

function isAutocompleteDebugEnabled(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }

  try {
    return localStorage.getItem('pulsesql:debug-autocomplete') === '1';
  } catch {
    return false;
  }
}
