import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { useQueriesStore } from '../../store/queries';
import { type DatabaseEngine, useConnectionsStore, getConnectionColor, hexToRgba } from '../../store/connections';
import { invoke } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { ensureColumnsCached, ensureSchemasCached, ensureTablesCached, invalidateMetadataCache } from '../database/metadata-cache';
import { useDatabaseSessionStore } from '../../store/databaseSession';
import type { MetadataColumn } from '../database/types';
import {
  Plus,
  X,
  Play,
  LoaderCircle,
  AlertCircle,
  Clock3,
  Download,
  FileJson,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  RotateCcw,
  Trash2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import ResultGrid from './ResultGrid';
import QueryHistoryDrawer from '../history/components/QueryHistoryDrawer';
import type { QueryHistoryItem } from '../history/types';
import { isTableSuggestionContext, registerSqlAutocomplete } from './sql-autocomplete';
import {
  buildQueryErrorPresentation,
  extractErrorMessage,
  type QueryErrorPresentation,
} from './query-error-utils';
import { useConnectionRuntimeStore } from '../../store/connectionRuntime';
import { useUiPreferencesStore } from '../../store/uiPreferences';
import { formatNumber, translate } from '../../i18n';
import { ensureMonacoThemes, resolveMonacoTheme } from '../../lib/monaco-theme';

interface QueryResult {
  columns: string[];
  column_meta?: QueryColumnMeta[];
  rows: any[];
  execution_time: number;
  summary?: string | null;
  total_rows?: number | null;
  page?: number | null;
  page_size?: number | null;
}

interface QueryColumnMeta {
  name: string;
  data_type: string;
}

interface ResultGridColumn {
  name: string;
  subtitle?: string | null;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
}

interface QueryExecutionResult extends QueryResult {
  statement: string;
  title: string;
}

interface ExecuteQueryPayload {
  result: QueryResult;
  history_item_id: string;
  autocommit_enabled: boolean;
  transaction_open: boolean;
}

const SEMANTIC_SUCCESS_DURATION_MS = 3600;
const SEMANTIC_ERROR_DURATION_MS = 6200;
const SEMANTIC_WARNING_DURATION_MS = 6200;
const CONNECTION_MENU_WIDTH = 340;

export default function QueryWorkspace() {
  const {
    tabs,
    activeTabId,
    pendingExecutionTabId,
    addTab,
    addTabWithContent,
    setActiveTab,
    closeTab,
    updateTabContent,
    replaceActiveTabContent,
    setTabConnection,
    clearPendingExecution,
  } = useQueriesStore();
  const { activeConnectionId, connections, setActiveConnection } = useConnectionsStore();
  const runtimeStatusMap = useConnectionRuntimeStore((state) => state.runtimeStatus);
  const transactionOpenByConnection = useConnectionRuntimeStore((state) => state.transactionOpenByConnection);
  const connectionLogs = useConnectionRuntimeStore((state) => state.connectionLogs);
  const setRuntimeStatus = useConnectionRuntimeStore((state) => state.setRuntimeStatus);
  const appendLog = useConnectionRuntimeStore((state) => state.appendLog);
  const setAutocommitEnabled = useConnectionRuntimeStore((state) => state.setAutocommitEnabled);
  const setTransactionOpen = useConnectionRuntimeStore((state) => state.setTransactionOpen);
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const locale = useUiPreferencesStore((state) => state.locale);
  const semanticBackgroundState = useUiPreferencesStore((state) => state.semanticBackgroundState);
  const semanticBackgroundVersion = useUiPreferencesStore((state) => state.semanticBackgroundVersion);
  const setSemanticBackgroundState = useUiPreferencesStore((state) => state.setSemanticBackgroundState);
  const resultPageSize = useUiPreferencesStore((state) => state.resultPageSize);
  const setResultPageSize = useUiPreferencesStore((state) => state.setResultPageSize);
  const themeId = useUiPreferencesStore((state) => state.themeId);
  const editorFontSize = useUiPreferencesStore((state) => state.editorFontSize);
  const density = useUiPreferencesStore((state) => state.density);
  const metadataByConnection = useDatabaseSessionStore((state) => state.metadataByConnection);
  const activeSchemaByConnection = useDatabaseSessionStore((state) => state.activeSchemaByConnection);
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params);
  
  const activeTab = tabs.find(t => t.id === activeTabId);
  const resolvedConnectionId = activeTab?.connectionId ?? activeConnectionId ?? null;
  const selectedConnection = connections.find((connection) => connection.id === resolvedConnectionId) ?? null;
  const connectionColor = getConnectionColor(connections, resolvedConnectionId);
  const engine = selectedConnection?.engine;
  const connectionLabel = selectedConnection?.name;
  const schemaLabel = resolvedConnectionId ? activeSchemaByConnection[resolvedConnectionId] ?? selectedConnection?.preferredSchema : undefined;
  const runtimeStatus = resolvedConnectionId ? runtimeStatusMap[resolvedConnectionId] : undefined;
  const isConnectionReady = runtimeStatus === 'connected';
  const transactionOpen = resolvedConnectionId ? transactionOpenByConnection[resolvedConnectionId] === true : false;
  const activeConnectionLogCount = resolvedConnectionId ? (connectionLogs[resolvedConnectionId]?.length ?? 0) : 0;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<QueryErrorPresentation | null>(null);
  const [results, setResults] = useState<QueryExecutionResult[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [quickFilterInput, setQuickFilterInput] = useState('');
  const [quickFilter, setQuickFilter] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuickFilter(quickFilterInput), 150);
    return () => clearTimeout(timer);
  }, [quickFilterInput]);
  const [resultsHeight, setResultsHeight] = useState(34);
  const [resultsResizing, setResultsResizing] = useState(false);
  const [pendingRiskyExecution, setPendingRiskyExecution] = useState<string[] | null>(null);
  const [pageSizeDraft, setPageSizeDraft] = useState(String(resultPageSize));
  const [connectionMenuOpen, setConnectionMenuOpen] = useState(false);
  const [connectionMenuPosition, setConnectionMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [exportedFormat, setExportedFormat] = useState<'csv' | 'json' | null>(null);
  const exportFeedbackRef = useRef<number | null>(null);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [selectedSourceRowIndex, setSelectedSourceRowIndex] = useState<number | null>(null);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [gridFullscreen, setGridFullscreen] = useState(false);
  const [activePanel, setActivePanel] = useState<'results' | 'logs'>('results');
  const editErrorTimeoutRef = useRef<number | null>(null);
  const executeQueryRef = useRef<() => void>(() => {});
  const editorRef = useRef<any>(null);
  const connectionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastCursorPositionRef = useRef<{ lineNumber: number; column: number } | null>(null);
  const autocompleteDisposableRef = useRef<{ dispose(): void } | null>(null);
  const suggestTimeoutRef = useRef<number | null>(null);
  const semanticResetTimeoutRef = useRef<number | null>(null);
  const autocompleteContextRef = useRef<{
    connectionId?: string | null;
    activeSchema?: string | null;
    engine?: DatabaseEngine | null;
  }>({
    connectionId: resolvedConnectionId,
    activeSchema: schemaLabel,
    engine,
  });

  useEffect(() => {
    autocompleteContextRef.current = {
      connectionId: resolvedConnectionId,
      activeSchema: schemaLabel,
      engine,
    };
  }, [resolvedConnectionId, engine, schemaLabel]);

  useEffect(() => {
    if (!resolvedConnectionId || !engine || !schemaLabel || runtimeStatus !== 'connected') {
      return;
    }

    void ensureTablesCached(resolvedConnectionId, engine, schemaLabel).catch(() => null);
  }, [engine, resolvedConnectionId, runtimeStatus, schemaLabel]);

  useEffect(() => () => {
    autocompleteDisposableRef.current?.dispose();
    if (suggestTimeoutRef.current) {
      window.clearTimeout(suggestTimeoutRef.current);
    }
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!gridFullscreen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setGridFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [gridFullscreen]);

  useEffect(() => {
    if (!connectionMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (connectionMenuButtonRef.current?.contains(target)) {
        return;
      }

      setConnectionMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectionMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [connectionMenuOpen]);

  const scheduleSemanticReset = useCallback((durationMs: number) => {
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
    }

    semanticResetTimeoutRef.current = window.setTimeout(() => {
      setSemanticBackgroundState('idle');
      semanticResetTimeoutRef.current = null;
    }, durationMs);
  }, [setSemanticBackgroundState]);

  const syncTransactionState = useCallback((connectionId: string, payload: ExecuteQueryPayload) => {
    setAutocommitEnabled(connectionId, payload.autocommit_enabled);
    setTransactionOpen(connectionId, payload.transaction_open);
  }, [setAutocommitEnabled, setTransactionOpen]);

  const runQueryBatch = useCallback(async (queries: string[], connectionId: string) => {
    const statements = queries.map((item) => item.trim()).filter(Boolean);
    if (!statements.length || !connectionId) {
      return;
    }
    const targetConnection = connections.find((item) => item.id === connectionId) ?? null;
    const targetEngine = targetConnection?.engine;
    const targetSchema = activeSchemaByConnection[connectionId] ?? targetConnection?.preferredSchema;
    
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
      semanticResetTimeoutRef.current = null;
    }

    setSemanticBackgroundState('running');
    setLoading(true);
    setError(null);
    setActivePanel('results');

    try {
      const nextResults: QueryExecutionResult[] = [];

      for (let index = 0; index < statements.length; index++) {
        const statement = statements[index];
        const payload = await invoke<ExecuteQueryPayload>('execute_query', {
          connId: connectionId,
          query: statement,
          page: 1,
          pageSize: resultPageSize,
        });
        syncTransactionState(connectionId, payload);

        nextResults.push({
          ...payload.result,
          statement,
          title: `Result ${index + 1}`,
        });

        appendLog(
          connectionId,
          `Query executada com sucesso (${payload.result.execution_time}ms): ${summarizeStatementForLog(statement)}`,
        );

        const sourceTable = resolveSimpleSourceTable(statement, targetSchema ?? null);
        if (sourceTable?.tableName && targetEngine) {
          const schemaForFetch = sourceTable.schemaName ?? targetSchema ?? null;
          if (schemaForFetch) {
            void ensureColumnsCached(connectionId, targetEngine, schemaForFetch, sourceTable.tableName).catch(() => null);
          }
        }
      }

      setResults(nextResults);
      setActiveResultIndex(0);
      setSemanticBackgroundState('success');
      scheduleSemanticReset(SEMANTIC_SUCCESS_DURATION_MS);
    } catch (e: any) {
      const nextError = buildQueryErrorPresentation({
        error: e,
        engine: targetEngine,
        statement: statements[0] ?? null,
        activeSchema: targetSchema,
        metadataConnection: metadataByConnection[connectionId],
      });
      setError(nextError);
      appendLog(connectionId, `Erro de query: ${extractErrorMessage(e).trim()}`);
      setSemanticBackgroundState('error');
      scheduleSemanticReset(SEMANTIC_ERROR_DURATION_MS);
    } finally {
      setLoading(false);
    }
  }, [activeSchemaByConnection, appendLog, connections, metadataByConnection, resultPageSize, scheduleSemanticReset, setSemanticBackgroundState]);

  const ensureExecutionConnectionReady = useCallback(async (connectionId: string) => {
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) {
      throw new Error(t('noActiveConnection'));
    }

    const currentStatus = runtimeStatusMap[connectionId] ?? 'disconnected';
    if (currentStatus === 'connected') {
      setActiveConnection(connectionId);
      return connection;
    }

    appendLog(
      connectionId,
      t('openingConnectionWithTimeout', { name: connection.name, seconds: connection.connectTimeoutSeconds ?? 10 }),
    );
    setRuntimeStatus(connectionId, 'connecting');

    try {
      await invoke('open_connection', { config: connection });
      setRuntimeStatus(connectionId, 'connected');
      setActiveConnection(connectionId);
      invalidateMetadataCache(connectionId);
      appendLog(connectionId, t('connectionOpenedSuccessfully'));
      void ensureSchemasCached(connectionId, connection.engine, { markActive: true }).catch(() => null);
      return connection;
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : String(openError);
      setRuntimeStatus(connectionId, 'failed');
      appendLog(connectionId, message);
      throw openError;
    }
  }, [appendLog, connections, runtimeStatusMap, setActiveConnection, setRuntimeStatus, t]);

  const executeStatements = useCallback(async (statements: string[]) => {
    if (!resolvedConnectionId) {
      return;
    }

    await ensureExecutionConnectionReady(resolvedConnectionId);
    await runQueryBatch(statements, resolvedConnectionId);
  }, [ensureExecutionConnectionReady, resolvedConnectionId, runQueryBatch]);

  const executeQuery = useCallback(async (options?: { skipRiskConfirmation?: boolean }) => {
    if (!activeTab || !resolvedConnectionId) return;

    const executionTarget = resolveExecutionTarget(
      editorRef.current,
      activeTab.content,
      lastCursorPositionRef.current,
    );
    if (!executionTarget.statements.length) {
      return;
    }

    if (!options?.skipRiskConfirmation && hasUpdateWithoutWhere(executionTarget.statements)) {
      setPendingRiskyExecution(executionTarget.statements);
      setSemanticBackgroundState('warning');
      scheduleSemanticReset(SEMANTIC_WARNING_DURATION_MS);
      return;
    }

    setPendingRiskyExecution(null);
    await executeStatements(executionTarget.statements);
  }, [activeTab, executeStatements, resolvedConnectionId, scheduleSemanticReset, setSemanticBackgroundState]);

  const runHistoryItem = useCallback(async (item: QueryHistoryItem, replaceCurrent: boolean) => {
    const connection = connections.find((current) => current.id === item.connectionId);

    if (!connection) {
      setError({
        title: 'Falha ao abrir o histórico',
        summary: 'A conexão salva para este item de histórico não existe mais.',
        technicalMessage: 'A configuração da conexão vinculada ao item de histórico não foi encontrada.',
        suggestions: [],
      });
      return;
    }

    if (replaceCurrent) {
      replaceActiveTabContent(item.queryText, deriveHistoryTabTitle(item.queryText), item.connectionId);
    } else {
      addTabWithContent(item.queryText, deriveHistoryTabTitle(item.queryText), item.connectionId);
    }

    try {
      await ensureExecutionConnectionReady(connection.id);
      await runQueryBatch(splitSqlStatements(item.queryText), connection.id);
    } catch (runError) {
      setError(
        buildQueryErrorPresentation({
          error: runError,
          engine: connection.engine,
          statement: item.queryText,
          activeSchema: connection.preferredSchema ?? schemaLabel,
        }),
      );
    }
  }, [addTabWithContent, connections, ensureExecutionConnectionReady, replaceActiveTabContent, runQueryBatch, schemaLabel]);

  const openHistoryInNewTab = useCallback((item: QueryHistoryItem) => {
    addTabWithContent(item.queryText, deriveHistoryTabTitle(item.queryText), item.connectionId);
  }, [addTabWithContent]);

  const replaceCurrentWithHistory = useCallback((item: QueryHistoryItem) => {
    replaceActiveTabContent(item.queryText, deriveHistoryTabTitle(item.queryText), item.connectionId);
  }, [replaceActiveTabContent]);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((current) => !current);
  }, []);

  const closeResultTab = useCallback((indexToClose: number) => {
    setResults((current) => {
      const next = current.filter((_, index) => index !== indexToClose);

      setActiveResultIndex((currentIndex) => {
        if (!next.length) {
          return 0;
        }

        if (currentIndex > indexToClose) {
          return currentIndex - 1;
        }

        if (currentIndex === indexToClose) {
          return Math.max(0, Math.min(indexToClose, next.length - 1));
        }

        return currentIndex;
      });

      return next;
    });
  }, []);

  const loadResultPage = useCallback(async (resultIndex: number, nextPage: number) => {
    const targetResult = results[resultIndex];
    if (!targetResult || !resolvedConnectionId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await ensureExecutionConnectionReady(resolvedConnectionId);
      const payload = await invoke<ExecuteQueryPayload>('execute_query', {
        connId: resolvedConnectionId,
        query: targetResult.statement,
        page: nextPage,
        pageSize: targetResult.page_size ?? resultPageSize,
        // Pass the already-known total so the backend skips an extra COUNT(*) query.
        knownTotalRows: targetResult.total_rows ?? undefined,
      });
      syncTransactionState(resolvedConnectionId, payload);

      setResults((current) =>
        current.map((item, index) =>
          index === resultIndex
            ? {
                ...payload.result,
                statement: item.statement,
                title: item.title,
              }
            : item,
        ),
      );
      setActiveResultIndex(resultIndex);
    } catch (pageError) {
      setError(
        buildQueryErrorPresentation({
          error: pageError,
          engine,
          statement: targetResult.statement,
          activeSchema: schemaLabel,
          metadataConnection: resolvedConnectionId ? metadataByConnection[resolvedConnectionId] : undefined,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [ensureExecutionConnectionReady, engine, metadataByConnection, resolvedConnectionId, resultPageSize, results, schemaLabel]);

  useEffect(() => {
    setPageSizeDraft(String(resultPageSize));
  }, [resultPageSize]);

  useEffect(() => {
    executeQueryRef.current = () => {
      void executeQuery();
    };
  }, [executeQuery]);

  useEffect(() => {
    if (!pendingExecutionTabId || pendingExecutionTabId !== activeTabId) {
      return;
    }

    if (loading || !activeTab || !resolvedConnectionId) {
      return;
    }

    clearPendingExecution();
    void executeQuery();
  }, [
    activeTab,
    activeTabId,
    clearPendingExecution,
    executeQuery,
    isConnectionReady,
    loading,
    pendingExecutionTabId,
    resolvedConnectionId,
  ]);

  useEffect(() => () => {
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
    }
    if (exportFeedbackRef.current) {
      window.clearTimeout(exportFeedbackRef.current);
    }
    if (editErrorTimeoutRef.current) {
      window.clearTimeout(editErrorTimeoutRef.current);
    }
    setSemanticBackgroundState('idle');
  }, [setSemanticBackgroundState]);

  useEffect(() => {
    if (!resultsResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const viewportHeight = window.innerHeight || 1;
      const nextHeight = ((viewportHeight - event.clientY) / viewportHeight) * 100;
      setResultsHeight(Math.min(Math.max(nextHeight, 22), 58));
    };

    const handlePointerUp = () => {
      setResultsResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resultsResizing]);

  const activeResult = results[activeResultIndex] ?? null;
  const filteredRows = activeResult
    ? applyQuickFilter(activeResult.rows, activeResult.columns, quickFilter)
    : [];
  const hasGridResult = Boolean(activeResult?.columns.length);
  const activeSourceTable = useMemo(
    () => resolveSimpleSourceTable(activeResult?.statement, schemaLabel),
    [activeResult?.statement, schemaLabel],
  );
  const cachedSourceColumns = resolvedConnectionId && activeSourceTable?.schemaName && activeSourceTable.tableName
    ? metadataByConnection[resolvedConnectionId]?.schemasByName[activeSourceTable.schemaName]?.tablesByName[activeSourceTable.tableName]?.columns
    : undefined;
  const totalRows = activeResult?.total_rows ?? activeResult?.rows.length ?? 0;
  const currentPage = activeResult?.page ?? 1;
  const pageSize = activeResult?.page_size ?? resultPageSize;
  const totalPages = Math.max(1, Math.ceil(totalRows / Math.max(pageSize, 1)));
  const canPaginate = hasGridResult && activeResult?.page != null && activeResult?.page_size != null;
  const rowNumberOffset = canPaginate ? (currentPage - 1) * pageSize : 0;
  const selectedDisplayRowIndex =
    selectedSourceRowIndex != null && activeResult
      ? filteredRows.findIndex((row) => activeResult.rows[selectedSourceRowIndex] === row)
      : null;
  const gridColumns = useMemo(
    () => buildGridColumns(activeResult, cachedSourceColumns),
    [activeResult, cachedSourceColumns],
  );

  useEffect(() => {
    setSelectedSourceRowIndex(null);
  }, [activeResultIndex, resolvedConnectionId, quickFilter, activeResult?.statement]);

  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('pulsesql:workspace-metrics', {
        detail: {
          connectionId: resolvedConnectionId,
          visibleRows: activeResult ? filteredRows.length : null,
          totalRows: activeResult?.total_rows ?? activeResult?.rows.length ?? null,
          executionTime: activeResult?.execution_time ?? null,
        },
      }),
    );

    return () => {
      window.dispatchEvent(
        new CustomEvent('pulsesql:workspace-metrics', {
          detail: {
            connectionId: resolvedConnectionId,
            visibleRows: null,
            totalRows: null,
            executionTime: null,
          },
        }),
      );
    };
  }, [activeResult, filteredRows.length, resolvedConnectionId]);

  useEffect(() => {
    if (!resolvedConnectionId || !engine || !activeSourceTable?.schemaName || !activeSourceTable.tableName || runtimeStatus !== 'connected') {
      return;
    }

    if (cachedSourceColumns?.length) {
      return;
    }

    void ensureColumnsCached(resolvedConnectionId, engine, activeSourceTable.schemaName, activeSourceTable.tableName).catch(() => null);
  }, [activeSourceTable, cachedSourceColumns, engine, resolvedConnectionId, runtimeStatus]);

  const applyPageSize = useCallback(async () => {
    const parsed = Number(pageSizeDraft);
    const normalized = Math.min(1000, Math.max(1, Number.isFinite(parsed) ? Math.round(parsed) : resultPageSize));
    setPageSizeDraft(String(normalized));
    setResultPageSize(normalized);

    if (!activeResult || !resolvedConnectionId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await ensureExecutionConnectionReady(resolvedConnectionId);
      const payload = await invoke<ExecuteQueryPayload>('execute_query', {
        connId: resolvedConnectionId,
        query: activeResult.statement,
        page: 1,
        pageSize: normalized,
      });
      syncTransactionState(resolvedConnectionId, payload);

      setResults((current) =>
        current.map((item, index) =>
          index === activeResultIndex
            ? {
                ...payload.result,
                statement: item.statement,
                title: item.title,
              }
            : item,
        ),
      );
    } catch (pageSizeError) {
      setError(
        buildQueryErrorPresentation({
          error: pageSizeError,
          engine,
          statement: activeResult.statement,
          activeSchema: schemaLabel,
          metadataConnection: resolvedConnectionId ? metadataByConnection[resolvedConnectionId] : undefined,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [activeResult, activeResultIndex, ensureExecutionConnectionReady, engine, metadataByConnection, pageSizeDraft, resolvedConnectionId, resultPageSize, schemaLabel, setResultPageSize]);

  const handleCellEdit = useCallback(async (
    colName: string,
    rowIndex: number,
    newValue: string | null,
    row: Record<string, unknown>,
  ) => {
    if (!resolvedConnectionId || !activeSourceTable?.tableName) return;

    const pkCols = cachedSourceColumns?.filter((c) => c.isPrimaryKey) ?? [];
    if (!pkCols.length) {
      setEditError('No primary key detected — cannot safely update this row.');
      setEditingCell(`${rowIndex}-${colName}`);
      if (editErrorTimeoutRef.current) window.clearTimeout(editErrorTimeoutRef.current);
      editErrorTimeoutRef.current = window.setTimeout(() => {
        setEditError(null);
        setEditingCell(null);
      }, 3500);
      return;
    }

    const cellKey = `${rowIndex}-${colName}`;
    setEditingCell(cellKey);
    setEditError(null);

    try {
      await ensureExecutionConnectionReady(resolvedConnectionId);
      const sourceRowIndex = activeResult?.rows.indexOf(row) ?? -1;
      const sql = buildUpdateSql(
        activeSourceTable.schemaName,
        activeSourceTable.tableName,
        colName,
        newValue,
        row,
        pkCols,
        engine ?? 'postgres',
      );
      const payload = await invoke<ExecuteQueryPayload>('execute_query', {
        connId: resolvedConnectionId,
        query: sql,
        page: 1,
        pageSize: 1,
      });
      syncTransactionState(resolvedConnectionId, payload);
      setHistoryRefreshToken((current) => current + 1);
      setResults((current) =>
        current.map((item, idx) =>
          idx === activeResultIndex
            ? {
                ...item,
                rows: item.rows.map((r, rIdx) =>
                  rIdx === sourceRowIndex ? { ...r, [colName]: newValue } : r,
                ),
              }
            : item,
        ),
      );
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setEditError(msg);
      if (editErrorTimeoutRef.current) window.clearTimeout(editErrorTimeoutRef.current);
      editErrorTimeoutRef.current = window.setTimeout(() => {
        setEditError(null);
        setEditingCell(null);
      }, 3500);
      return;
    }

    setEditingCell(null);
  }, [activeResult, activeResultIndex, activeSourceTable, cachedSourceColumns, engine, ensureExecutionConnectionReady, resolvedConnectionId]);

  const handleRowSelect = useCallback((_rowIndex: number, row: Record<string, unknown>) => {
    if (!activeResult) {
      setSelectedSourceRowIndex(null);
      return;
    }

    const sourceIndex = activeResult.rows.indexOf(row);
    if (sourceIndex < 0) {
      setSelectedSourceRowIndex(null);
      return;
    }

    setSelectedSourceRowIndex((current) => (current === sourceIndex ? null : sourceIndex));
  }, [activeResult]);

  const handleDeleteSelectedRow = useCallback(async () => {
    if (
      !resolvedConnectionId ||
      !activeSourceTable?.tableName ||
      selectedSourceRowIndex == null ||
      !activeResult?.rows[selectedSourceRowIndex]
    ) {
      return;
    }

    const pkCols = cachedSourceColumns?.filter((c) => c.isPrimaryKey) ?? [];
    if (!pkCols.length) {
      setEditError('No primary key detected — cannot safely delete this row.');
      if (editErrorTimeoutRef.current) window.clearTimeout(editErrorTimeoutRef.current);
      editErrorTimeoutRef.current = window.setTimeout(() => {
        setEditError(null);
      }, 3500);
      return;
    }

    const row = activeResult.rows[selectedSourceRowIndex] as Record<string, unknown>;
    setEditError(null);

    try {
      await ensureExecutionConnectionReady(resolvedConnectionId);
      const sql = buildDeleteSql(
        activeSourceTable.schemaName,
        activeSourceTable.tableName,
        row,
        pkCols,
        engine ?? 'postgres',
      );

      const payload = await invoke<ExecuteQueryPayload>('execute_query', {
        connId: resolvedConnectionId,
        query: sql,
        page: 1,
        pageSize: 1,
      });
      syncTransactionState(resolvedConnectionId, payload);

      setHistoryRefreshToken((current) => current + 1);
      setResults((current) =>
        current.map((item, idx) => {
          if (idx !== activeResultIndex) {
            return item;
          }

          const nextRows = item.rows.filter((_, rowIdx) => rowIdx !== selectedSourceRowIndex);
          return {
            ...item,
            rows: nextRows,
            total_rows:
              typeof item.total_rows === 'number'
                ? Math.max(0, item.total_rows - 1)
                : item.total_rows,
          };
        }),
      );
      setSelectedSourceRowIndex(null);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setEditError(msg);
      if (editErrorTimeoutRef.current) window.clearTimeout(editErrorTimeoutRef.current);
      editErrorTimeoutRef.current = window.setTimeout(() => {
        setEditError(null);
      }, 3500);
    }
  }, [
    activeResult,
    activeResultIndex,
    activeSourceTable,
    cachedSourceColumns,
    engine,
    ensureExecutionConnectionReady,
    resolvedConnectionId,
    selectedSourceRowIndex,
  ]);

  const handleTransactionAction = useCallback(async (action: 'COMMIT' | 'ROLLBACK') => {
    if (!resolvedConnectionId) {
      return;
    }

    await ensureExecutionConnectionReady(resolvedConnectionId);
    const payload = await invoke<ExecuteQueryPayload>('execute_query', {
      connId: resolvedConnectionId,
      query: action,
      page: 1,
      pageSize: 1,
    });
    syncTransactionState(resolvedConnectionId, payload);
    setResults([
      {
        ...payload.result,
        statement: action,
        title: t('result'),
      },
    ]);
    setActiveResultIndex(0);
    setHistoryRefreshToken((current) => current + 1);
  }, [ensureExecutionConnectionReady, resolvedConnectionId, syncTransactionState, t]);

  const handleConnectionChange = useCallback((nextConnectionId: string) => {
    if (!activeTab) {
      return;
    }

    const normalizedConnectionId = nextConnectionId || null;
    setTabConnection(activeTab.id, normalizedConnectionId);
    setActiveConnection(normalizedConnectionId);
    setConnectionMenuOpen(false);
  }, [activeTab, setActiveConnection, setTabConnection]);

  const toggleConnectionMenu = useCallback(() => {
    const rect = connectionMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    setConnectionMenuPosition({
      x: Math.round(Math.max(8, Math.min(rect.right - CONNECTION_MENU_WIDTH, window.innerWidth - CONNECTION_MENU_WIDTH - 8))),
      y: Math.round(Math.min(rect.bottom + 8, window.innerHeight - 220)),
    });
    setConnectionMenuOpen((current) => !current);
  }, []);

  useEffect(() => {
    if (!activeTab || activeTab.connectionId !== undefined || !activeConnectionId) {
      return;
    }

    setTabConnection(activeTab.id, activeConnectionId);
  }, [activeConnectionId, activeTab, setTabConnection]);

  const renderResultsPanel = (fullscreen = false) => (
    <div
      className={`rounded-lg border border-border/80 glass-panel flex flex-col relative overflow-hidden shadow-[0_18px_48px_rgba(0,0,0,0.24)] ${
        fullscreen
          ? 'h-full min-h-0'
          : 'min-h-[190px] max-h-[58%] shrink-0 flex-grow-0 max-[720px]:h-[40%]'
      }`}
      style={fullscreen ? undefined : { height: `${resultsHeight}%` }}
    >
      <div
        className="flex flex-wrap items-center gap-2 border-b border-border/80 px-3"
        style={{ background: 'var(--bt-surface)', paddingTop: 8, paddingBottom: 8 }}
      >
        {/* Pill tabs */}
        <div style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--bt-background)', borderRadius: 7, border: '1px solid var(--bt-border)', flexShrink: 0 }}>
          {(results.length ? results : [{ title: t('result') } as QueryExecutionResult]).map((item, index) => (
            <div key={`${item.title}-${index}`} className="inline-flex items-center">
              <button
                onClick={() => { setActiveResultIndex(index); setActivePanel('results'); }}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition-colors"
                style={activePanel === 'results' && activeResultIndex === index
                  ? { background: hexToRgba(connectionColor, 0.15), color: connectionColor, border: `1px solid ${hexToRgba(connectionColor, 0.30)}` }
                  : { background: 'transparent', color: 'var(--bt-muted)', border: '1px solid transparent' }
                }
              >
                {results.length <= 1 ? t('result') : item.title}
                {results.length > 1 ? (
                  <span
                    onClick={(event) => { event.stopPropagation(); closeResultTab(index); }}
                    className="ml-1 hover:text-text transition-colors"
                    aria-label={`Fechar ${item.title}`}
                  >
                    <X size={11} />
                  </span>
                ) : null}
              </button>
            </div>
          ))}
          <button
            onClick={() => setActivePanel('logs')}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors"
            style={activePanel === 'logs'
              ? { background: hexToRgba(connectionColor, 0.15), color: connectionColor, border: `1px solid ${hexToRgba(connectionColor, 0.30)}` }
              : { background: 'transparent', color: 'var(--bt-muted)', border: '1px solid transparent' }
            }
          >
            Logs
            {activeConnectionLogCount > 0 ? (
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, opacity: 0.75 }}>
                {activeConnectionLogCount}
              </span>
            ) : null}
          </button>
        </div>

        {activeResult ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="hidden md:flex items-center gap-1.5 text-xs shrink-0" style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--bt-muted)' }}>
              {hasGridResult ? (
                <>
                  <span style={{ color: connectionColor }}>✓</span>
                  <span>
                    {formatNumber(locale, filteredRows.length)}
                    {quickFilter ? ` / ${formatNumber(locale, activeResult.rows.length)}` : ''} {t('rowsLabel')}
                  </span>
                  {canPaginate ? (
                    <>
                      <span style={{ opacity: 0.4 }}>│</span>
                      <span>{t('pageOf', { page: currentPage, total: totalPages })}</span>
                    </>
                  ) : null}
                  <span style={{ opacity: 0.4 }}>│</span>
                </>
              ) : null}
              <span style={{ color: connectionColor }}>{activeResult.execution_time}ms</span>
            </div>
            {transactionOpen ? (
              <>
                <span className="inline-flex items-center rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-xs text-sky-200">
                  {t('transactionOpen')}
                </span>
                <button
                  type="button"
                  onClick={() => void handleTransactionAction('COMMIT')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/35 bg-emerald-400/12 px-2.5 py-1.5 text-xs text-emerald-200 transition-colors hover:bg-emerald-400/18"
                >
                  {t('commitAction')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleTransactionAction('ROLLBACK')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-400/16"
                >
                  {t('rollbackAction')}
                </button>
              </>
            ) : null}
            {hasGridResult ? (
              <>
                {canPaginate ? (
                  <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/24 px-1.5 py-1">
                    <label className="inline-flex items-center gap-1 rounded-md px-1 text-[11px] text-muted">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={pageSizeDraft}
                        onChange={(event) => setPageSizeDraft(event.target.value.replace(/[^0-9]/g, ''))}
                        onBlur={() => void applyPageSize()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void applyPageSize();
                          }
                        }}
                        className="w-14 rounded border border-border/70 bg-background/35 px-1.5 py-1 text-right text-[11px] text-text outline-none focus:border-primary"
                      />
                      <span>{t('rowsLabel')}</span>
                    </label>
                    <button
                      onClick={() => void loadResultPage(activeResultIndex, currentPage - 1)}
                      disabled={loading || currentPage <= 1}
                      className="inline-flex items-center rounded-md px-1.5 py-1 text-xs text-muted hover:bg-border/30 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t('previousPage')}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="px-1 text-[11px] text-muted">
                      {currentPage}/{totalPages}
                    </span>
                    <button
                      onClick={() => void loadResultPage(activeResultIndex, currentPage + 1)}
                      disabled={loading || currentPage >= totalPages}
                      className="inline-flex items-center rounded-md px-1.5 py-1 text-xs text-muted hover:bg-border/30 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={t('nextPage')}
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                ) : null}
                <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/30 px-2.5 py-1.5 min-w-[180px] md:min-w-[220px]">
                  <Search size={13} className="shrink-0 text-muted" />
                  <input
                    value={quickFilterInput}
                    onChange={(event) => setQuickFilterInput(event.target.value)}
                    placeholder={t('quickFilter')}
                    className="w-full bg-transparent text-xs text-text outline-none placeholder:text-muted"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleDeleteSelectedRow()}
                  disabled={selectedSourceRowIndex == null || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/25 px-2.5 py-1.5 text-xs text-red-300 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                  title={t('deleteSelectedRow')}
                >
                  <Trash2 size={13} />
                  {t('deleteRow')}
                </button>
                <button
                  type="button"
                  onClick={() => setGridFullscreen((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-border/30 hover:text-text"
                  title={fullscreen ? t('exitFullscreenGrid') : t('maximizeGrid')}
                >
                  {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  {fullscreen ? t('exitFullscreenGrid') : t('maximizeGrid')}
                </button>
                <button
                  onClick={() => {
                    exportRowsAsCsv(activeResult.columns, filteredRows, buildExportBaseName(connectionLabel));
                    if (exportFeedbackRef.current) window.clearTimeout(exportFeedbackRef.current);
                    setExportedFormat('csv');
                    exportFeedbackRef.current = window.setTimeout(() => setExportedFormat(null), 1500);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    exportedFormat === 'csv'
                      ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-200'
                      : 'border-border text-muted hover:bg-border/30 hover:text-text'
                  }`}
                >
                  {exportedFormat === 'csv' ? <Check size={13} /> : <Download size={13} />}
                  CSV
                </button>
                <button
                  onClick={() => {
                    exportRowsAsJson(filteredRows, buildExportBaseName(connectionLabel));
                    if (exportFeedbackRef.current) window.clearTimeout(exportFeedbackRef.current);
                    setExportedFormat('json');
                    exportFeedbackRef.current = window.setTimeout(() => setExportedFormat(null), 1500);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    exportedFormat === 'json'
                      ? 'border-emerald-400/40 bg-emerald-400/12 text-emerald-200'
                      : 'border-border text-muted hover:bg-border/30 hover:text-text'
                  }`}
                >
                  {exportedFormat === 'json' ? <Check size={13} /> : <FileJson size={13} />}
                  JSON
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto bg-background/10 relative">
        {activePanel === 'logs' ? (
          <div className="h-full overflow-y-auto p-3" style={{ fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 11.5 }}>
            {resolvedConnectionId && connectionLogs[resolvedConnectionId]?.length ? (
              connectionLogs[resolvedConnectionId].map((entry, i) => (
                <div key={i} className="py-1 border-b border-border/30 last:border-0" style={{ color: 'var(--bt-muted)', lineHeight: 1.6 }}>
                  {entry}
                </div>
              ))
            ) : (
              <div className="flex h-full items-center justify-center text-muted/50 text-sm" style={{ fontFamily: 'inherit' }}>
                Nenhum log registrado para esta conexão.
              </div>
            )}
          </div>
        ) : null}
        {activePanel === 'results' && loading ? (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-[1px]">
            <div className="flex items-center gap-3">
              <LoaderCircle size={16} className="animate-spin text-primary" />
              <span className="text-[10px] uppercase tracking-[0.14em] text-primary/70">
                {t('loadingResults')}
              </span>
            </div>
          </div>
        ) : null}
        {activePanel === 'results' && error && !loading ? (
          <QueryErrorPanel error={error} activeSchema={schemaLabel} onRetry={() => void executeQuery()} />
        ) : activePanel === 'results' && activeResult ? (
          <div className="flex h-full min-h-0 flex-col">
            {activeResult.summary ? (
              <div className="border-b border-border/60 bg-emerald-400/5 px-4 py-3 text-xs text-emerald-100/90">
                <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-emerald-300/80">
                  {t('executionSummary')}
                </div>
                <pre className="whitespace-pre-wrap font-mono text-[12px] leading-6 text-emerald-100/90">
                  {activeResult.summary}
                </pre>
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              {hasGridResult ? (
                <ResultGrid
                  columns={gridColumns}
                  rows={filteredRows}
                  rowNumberOffset={quickFilter ? 0 : rowNumberOffset}
                  density={density}
                  onCellEdit={activeSourceTable ? handleCellEdit : undefined}
                  editingCell={editingCell}
                  editError={editError}
                  selectedRowIndex={selectedDisplayRowIndex}
                  onRowSelect={handleRowSelect}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-muted/50 text-sm">
                  {t('executionWithoutResultSet')}
                </div>
              )}
            </div>
          </div>
        ) : activePanel === 'results' ? (
          <div className="h-full flex items-center justify-center text-muted/50 text-sm">
            {t('runQueryToSeeResults')}
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden relative min-h-0">
      <div
        className={`sql-workspace-shell ${semanticBackgroundEnabled ? `sql-workspace-shell--${semanticBackgroundState}` : ''}`}
      >
        {semanticBackgroundEnabled ? (
          <div
            key={`${semanticBackgroundState}-${semanticBackgroundVersion}`}
            className={`sql-workspace-shell__ambient semantic-ambient semantic-ambient--${semanticBackgroundState}`}
          />
        ) : null}

        <div className="relative z-10 flex h-full min-h-0 flex-col gap-3">
          <div className="shrink-0 overflow-hidden">
            <div className="flex items-stretch overflow-x-auto scrollbar-hide" style={{ background: 'rgba(10,20,32,0.4)' }}>
              {tabs.map(tab => {
                const tabColor = getConnectionColor(connections, tab.connectionId ?? activeConnectionId);
                return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`group relative flex items-center gap-2 px-3 py-2.5 border-r border-border/60 min-w-[148px] max-w-[240px] cursor-pointer select-none transition-colors ${
                    activeTabId === tab.id ? 'text-text' : 'text-muted hover:bg-white/4'
                  }`}
                  style={{
                    background: activeTabId === tab.id ? 'var(--bt-surface)' : 'transparent',
                    borderBottom: activeTabId === tab.id ? '1px solid var(--bt-surface)' : '1px solid var(--bt-border)',
                  }}
                >
                  {activeTabId === tab.id && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                      background: tabColor, boxShadow: `0 0 10px ${tabColor}`,
                    }} />
                  )}
                  <span style={{ width: 6, height: 6, borderRadius: 2, flexShrink: 0, background: tabColor, opacity: activeTabId === tab.id ? 1 : 0.5 }} />
                  <span className="text-sm truncate flex-1">{tab.title}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                    className={`p-1 rounded hover:bg-border/50 text-muted transition-opacity flex-shrink-0 ${
                      activeTabId === tab.id ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <X size={14} />
                  </button>
                </div>
                );
              })}
              <button
                onClick={() => addTab(resolvedConnectionId)}
                className="flex flex-1 items-center px-3 text-muted hover:text-text transition-colors"
                style={{ borderBottom: '1px solid var(--bt-border)', minWidth: 40, paddingTop: 10, paddingBottom: 10 }}
                title={t('newQueryTab')}
              >
                <Plus size={14} />
              </button>
            </div>

            <div className="px-3 py-2.5 flex flex-wrap items-center gap-2" style={{ background: 'var(--bt-surface)', borderBottom: '1px solid var(--bt-border)' }}>
              <button
                onClick={() => void executeQuery()}
                disabled={loading || !activeTab || !resolvedConnectionId}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: connectionColor,
                  color: '#08111A',
                  border: 'none',
                  letterSpacing: 0.4,
                  boxShadow: `0 0 18px ${hexToRgba(connectionColor, 0.50)}, inset 0 1px 0 rgba(255,255,255,0.20)`,
                }}
              >
                {loading
                  ? <LoaderCircle size={14} className="animate-spin" style={{ color: '#08111A' }} />
                  : <Play size={14} style={{ fill: '#08111A', opacity: 0.75 }} />
                }
                {t('run')}
                <span style={{ opacity: 0.5, fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>⌘↵</span>
              </button>
              <button
                onClick={toggleHistory}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: historyOpen ? hexToRgba(connectionColor, 0.12) : 'var(--bt-surface)',
                  border: `1px solid ${historyOpen ? hexToRgba(connectionColor, 0.35) : 'var(--bt-border)'}`,
                  color: historyOpen ? connectionColor : 'var(--bt-muted)',
                }}
              >
                <Clock3 size={13} />
                {t('history')}
              </button>
              <div className="ml-auto flex min-w-0 w-full sm:w-auto items-center gap-2">
                <button
                  ref={connectionMenuButtonRef}
                  type="button"
                  onClick={toggleConnectionMenu}
                  className="flex w-full min-w-0 sm:min-w-[240px] items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors border-border/70 bg-background/22 hover:bg-border/30"
                  style={connectionMenuOpen ? { borderColor: hexToRgba(connectionColor, 0.45) } : undefined}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: connectionColor, boxShadow: `0 0 6px ${hexToRgba(connectionColor, 0.8)}` }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] uppercase tracking-[0.14em] text-muted">
                      {selectedConnection ? `${selectedConnection.engine.toUpperCase()} - ${selectedConnection.name}` : t('noActiveConnection')}
                    </div>
                  </div>
                  {schemaLabel ? (
                    <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted">
                      {schemaLabel}
                    </span>
                  ) : null}
                  {resolvedConnectionId && !isConnectionReady ? (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-200">
                      {t('disconnected')}
                    </span>
                  ) : null}
                  <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${connectionMenuOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          <div
            className="flex-1 relative min-h-0 flex flex-col overflow-hidden rounded-lg glass-panel shadow-[0_18px_48px_rgba(0,0,0,0.24)]"
            style={{
              border: `1px solid ${hexToRgba(connectionColor, 0.28)}`,
              borderLeft: `2px solid ${connectionColor}`,
              boxShadow: `0 18px 48px rgba(0,0,0,0.24), inset 4px 0 18px -4px ${hexToRgba(connectionColor, 0.10)}`,
            }}
          >
            {activeTab ? (
              <div className="flex-1 min-h-[220px] overflow-hidden rounded-lg bg-background/30">
                <Editor
                  height="100%"
                  language="sql"
                  theme={resolveMonacoTheme(themeId)}
                  value={activeTab.content}
                  onChange={(val) => updateTabContent(activeTab.id, val || "")}
                  beforeMount={(monaco) => {
                    ensureMonacoThemes(monaco);
                  }}
                  options={{
                    minimap: { enabled: false },
                    padding: { top: 18 },
                    fontSize: editorFontSize,
                    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                    scrollBeyondLastLine: false,
                    roundedSelection: false,
                    smoothScrolling: true,
                    overviewRulerBorder: false,
                    acceptSuggestionOnEnter: 'on',
                    quickSuggestionsDelay: 60,
                    tabCompletion: 'on',
                    wordBasedSuggestions: 'off',
                    fixedOverflowWidgets: false,
                    quickSuggestions: {
                      other: true,
                      comments: false,
                      strings: false,
                    },
                    suggestOnTriggerCharacters: true,
                    suggest: {
                      showStatusBar: false,
                      preview: true,
                      previewMode: 'subwordSmart',
                      selectionMode: 'always',
                    },
                  }}
                  onMount={(editor, monaco) => {
                    editorRef.current = editor;
                    autocompleteDisposableRef.current?.dispose();
                    autocompleteDisposableRef.current = registerSqlAutocomplete(monaco, () => autocompleteContextRef.current);
                    lastCursorPositionRef.current = editor.getPosition();
                    editor.onDidChangeModelContent(() => {
                      const position = editor.getPosition();
                      const model = editor.getModel();
                      if (!position || !model) {
                        return;
                      }

                      const sqlBeforeCursor = model.getValueInRange({
                        startLineNumber: 1,
                        startColumn: 1,
                        endLineNumber: position.lineNumber,
                        endColumn: position.column,
                      });

                      if (isTableSuggestionContext(sqlBeforeCursor)) {
                        if (suggestTimeoutRef.current) {
                          window.clearTimeout(suggestTimeoutRef.current);
                        }

                        suggestTimeoutRef.current = window.setTimeout(() => {
                          editor.trigger('pulsesql', 'editor.action.triggerSuggest', {});
                        }, 90);
                      }
                    });
                    editor.onDidChangeCursorPosition((event) => {
                      lastCursorPositionRef.current = event.position;
                    });
                    editor.addAction({
                      id: 'pulsesql.runQuery',
                      label: t('run'),
                      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
                      run: () => {
                        executeQueryRef.current();
                      },
                    });
                    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.NumpadEnter, () => {
                      executeQueryRef.current();
                    });
                  }}
                />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted bg-background/40">
                <div className="text-center">
                  <p className="mb-2">{t('noActiveQuery')}</p>
                  <button onClick={() => addTab(resolvedConnectionId)} className="px-4 py-2 glass-panel border border-border rounded-lg text-sm hover:text-text flex items-center gap-2 mx-auto">
                    <Plus size={16} /> {t('newQuery')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {!gridFullscreen ? (
            <>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize results panel"
                onPointerDown={() => setResultsResizing(true)}
                className="shrink-0 px-3"
              >
                <div className={`h-1 cursor-row-resize rounded-full bg-transparent transition-colors ${
                  resultsResizing ? 'bg-primary/40' : 'hover:bg-primary/25'
                }`}>
                  <div className="mx-auto h-full w-24 rounded-full bg-border/70" />
                </div>
              </div>
              {renderResultsPanel(false)}
            </>
          ) : null}
        </div>
      </div>

      <QueryHistoryDrawer
        open={historyOpen}
        locale={locale}
        connections={connections}
        refreshToken={historyRefreshToken}
        onClose={() => setHistoryOpen(false)}
        onOpenInNewTab={openHistoryInNewTab}
        onReplaceCurrent={replaceCurrentWithHistory}
        onRunAgain={(item) => void runHistoryItem(item, true)}
      />

      {gridFullscreen
        ? createPortal(
            <div
              className="fixed inset-0 z-[155] flex items-center justify-center bg-background/76 p-6 backdrop-blur-sm"
              onMouseDown={() => setGridFullscreen(false)}
            >
              <div
                className="flex h-[86vh] w-full max-w-[96vw] flex-col rounded-lg border border-border bg-surface/95 shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <div>
                    <div className="text-sm font-semibold text-text">{t('resultGridFullscreen')}</div>
                    <div className="text-xs text-muted">{activeResult?.title ?? t('result')}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setGridFullscreen(false)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
                    >
                      <Minimize2 size={12} />
                      {t('close')}
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 p-4">
                  {renderResultsPanel(true)}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {pendingRiskyExecution ? (
        <DangerousUpdateModal
          locale={locale}
          onCancel={() => {
            setPendingRiskyExecution(null);
            if (semanticResetTimeoutRef.current) {
              window.clearTimeout(semanticResetTimeoutRef.current);
              semanticResetTimeoutRef.current = null;
            }
            setSemanticBackgroundState('idle');
          }}
          onConfirm={() => void executeQuery({ skipRiskConfirmation: true })}
        />
      ) : null}

      {connectionMenuOpen && connectionMenuPosition
        ? createPortal(
            <div
              className="fixed z-[150] rounded-lg border border-border/80 bg-surface/95 p-1 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
              style={{ left: connectionMenuPosition.x, top: connectionMenuPosition.y, width: CONNECTION_MENU_WIDTH }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => handleConnectionChange('')}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  !resolvedConnectionId ? 'bg-background/55 text-primary' : 'text-text hover:bg-background/55'
                }`}
              >
                <span className="text-muted">{t('noActiveConnection')}</span>
              </button>
              {connections.map((connection) => {
                const isCurrent = connection.id === resolvedConnectionId;
                const connectionSchema = activeSchemaByConnection[connection.id] ?? connection.preferredSchema;
                const connectionState = runtimeStatusMap[connection.id] ?? 'disconnected';

                return (
                  <button
                    key={connection.id}
                    type="button"
                    onClick={() => handleConnectionChange(connection.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                      isCurrent ? 'bg-background/55 text-primary' : 'text-text hover:bg-background/55'
                    }`}
                  >
                    <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      connectionState === 'connected'
                        ? 'bg-emerald-400'
                        : connectionState === 'connecting' || connectionState === 'reconnecting'
                          ? 'bg-sky-400'
                          : connectionState === 'failed'
                            ? 'bg-red-400'
                            : 'bg-muted'
                    }`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{connection.name}</div>
                      <div className="truncate text-[10px] uppercase tracking-[0.14em] text-muted">
                        {connection.engine.toUpperCase()}{connectionSchema ? ` - ${connectionSchema}` : ''}
                      </div>
                    </div>
                    {connectionState !== 'connected' ? (
                      <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] text-amber-200">
                        {t('disconnected')}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function DangerousUpdateModal({
  locale,
  onCancel,
  onConfirm,
}: {
  locale: 'pt-BR' | 'en-US';
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-background/76 p-6 backdrop-blur-sm"
      onMouseDown={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-amber-400/30 bg-surface/95 shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <div className="text-sm font-semibold text-text">{translate(locale, 'confirmUpdateWithoutWhere')}</div>
          <div className="mt-1 text-xs text-muted">
            {translate(locale, 'confirmUpdateWithoutWhereDescription')}
          </div>
        </div>

        <div className="px-5 py-4 text-sm text-amber-100/90">
          {translate(locale, 'continueExecution')}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
          >
            {translate(locale, 'cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg border border-amber-400/40 bg-amber-400/12 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-400/18"
          >
            {translate(locale, 'continueExecution')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function QueryErrorPanel({
  error,
  activeSchema,
  onRetry,
}: {
  error: QueryErrorPresentation;
  activeSchema?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="p-4 md:p-5">
      <div className="rounded-xl border border-red-400/22 bg-red-400/7 px-4 py-4 shadow-[0_16px_48px_rgba(0,0,0,0.24)]">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border border-red-400/18 bg-red-400/10 p-2 text-red-300">
            <AlertCircle size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-red-200">{error.title}</div>
            <div className="mt-1 text-sm text-red-100/95">{error.summary}</div>

            {error.suggestions.length ? (
              <div className="mt-4 rounded-lg border border-amber-300/16 bg-amber-300/6 px-3 py-3">
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-200/80">
                  Você quis dizer
                </div>
                <div className="mt-2 space-y-1.5">
                  {error.suggestions.map((suggestion) => (
                    <div
                      key={`${suggestion.schemaName ?? 'schema'}.${suggestion.tableName}`}
                      className="rounded-md border border-border/60 bg-background/26 px-2.5 py-2 text-sm text-text"
                    >
                      {suggestion.schemaName && suggestion.schemaName !== activeSchema
                        ? `${suggestion.schemaName}.${suggestion.tableName}`
                        : suggestion.tableName}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-lg border border-border/60 bg-background/34 px-3 py-3">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                Mensagem técnica
              </div>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-muted/85">
                {error.technicalMessage}
              </pre>
            </div>

            {onRetry ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background/30 px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
                >
                  <RotateCcw size={12} />
                  Tentar novamente
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function deriveHistoryTabTitle(queryText: string): string {
  const firstLine = queryText
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return 'Query do histórico';
  }

  return firstLine.slice(0, 36);
}

function resolveExecutionTarget(
  editor: any,
  fallbackContent: string,
  lastCursorPosition?: { lineNumber: number; column: number } | null,
) {
  const model = editor?.getModel?.();
  const fullText = model?.getValue?.() ?? fallbackContent;
  const selection = editor?.getSelection?.();

  if (model && selection && !selection.isEmpty()) {
    const selectedText = model.getValueInRange(selection).trim();
    const statements = splitSqlStatements(selectedText);
    if (statements.length) {
      return { statements };
    }
  }

  const position = editor?.getPosition?.() ?? lastCursorPosition;
  if (!model || !position) {
    return { statements: splitSqlStatements(fullText) };
  }

  const cursorOffset = model.getOffsetAt(position);
  const statementsWithRange = splitSqlStatementsWithRange(fullText);
  const activeStatement = statementsWithRange.find((item) => cursorOffset >= item.start && cursorOffset <= item.end);

  if (activeStatement) {
    return { statements: [activeStatement.text] };
  }

  return { statements: splitSqlStatements(fullText) };
}

function splitSqlStatements(sql: string) {
  return splitSqlStatementsWithRange(sql).map((item) => item.text);
}

function hasUpdateWithoutWhere(statements: string[]) {
  return statements.some((statement) => isUpdateWithoutWhere(statement));
}

function isUpdateWithoutWhere(sql: string) {
  const normalized = stripSqlCommentsAndStrings(sql).replace(/\s+/g, ' ').trim().toUpperCase();
  return normalized.startsWith('UPDATE ') && !normalized.includes(' WHERE ');
}

function stripSqlCommentsAndStrings(sql: string) {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index++) {
    const currentChar = sql[index];
    const nextChar = sql[index + 1] ?? '';

    if (inLineComment) {
      if (currentChar === '\n') {
        inLineComment = false;
        result += currentChar;
      }
      continue;
    }

    if (inBlockComment) {
      if (currentChar === '*' && nextChar === '/') {
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && currentChar === '-' && nextChar === '-') {
      index += 1;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && currentChar === '/' && nextChar === '*') {
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (!inDoubleQuote && currentChar === "'") {
      if (inSingleQuote && nextChar === "'") {
        index += 1;
        continue;
      }

      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && currentChar === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      result += currentChar;
    }
  }

  return result;
}

function splitSqlStatementsWithRange(sql: string) {
  const statements: Array<{ text: string; start: number; end: number }> = [];
  let current = '';
  let statementStart = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index++) {
    const currentChar = sql[index];
    const nextChar = sql[index + 1] ?? '';

    if (!current.trim()) {
      statementStart = index;
    }

    if (inLineComment) {
      current += currentChar;
      if (currentChar === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += currentChar;
      if (currentChar === '*' && nextChar === '/') {
        current += nextChar;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && currentChar === '-' && nextChar === '-') {
      current += currentChar + nextChar;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && currentChar === '/' && nextChar === '*') {
      current += currentChar + nextChar;
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (!inDoubleQuote && currentChar === "'") {
      current += currentChar;
      if (inSingleQuote && nextChar === "'") {
        current += nextChar;
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (!inSingleQuote && currentChar === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += currentChar;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && currentChar === ';') {
      const text = current.trim();
      if (text) {
        statements.push({
          text,
          start: statementStart,
          end: index,
        });
      }
      current = '';
      statementStart = index + 1;
      continue;
    }

    current += currentChar;
  }

  const tail = current.trim();
  if (tail) {
    statements.push({
      text: tail,
      start: statementStart,
      end: sql.length,
    });
  }

  return statements;
}

function buildGridColumns(
  result: QueryResult | null,
  metadataColumns?: MetadataColumn[],
): ResultGridColumn[] {
  if (!result) {
    return [];
  }

  return result.columns.map((name, index) => {
    const resultMeta = result.column_meta?.[index];
    const metadataMatch = metadataColumns?.find(
      (column) => column.columnName.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0,
    );
    const subtitle = formatColumnSubtitle(resultMeta?.data_type ?? metadataMatch?.dataType, metadataMatch);

    return {
      name,
      subtitle,
      isPrimaryKey: metadataMatch?.isPrimaryKey === true,
      isForeignKey: metadataMatch?.isForeignKey === true,
    };
  });
}

function formatColumnSubtitle(dataType?: string | null, metadataColumn?: MetadataColumn) {
  const parts = [
    dataType?.trim() || null,
    metadataColumn?.isAutoIncrement ? 'autoincrement' : null,
  ].filter(Boolean);

  return parts.length ? parts.join(' • ') : null;
}

function resolveSimpleSourceTable(statement?: string | null, fallbackSchema?: string | null) {
  if (!statement) {
    return null;
  }

  const normalized = statement
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const match = normalized.match(/^\s*select\b[\s\S]*?\bfrom\s+((?:"[^"]+"|[a-zA-Z0-9_$#]+)(?:\.(?:"[^"]+"|[a-zA-Z0-9_$#]+))?)/i);
  if (!match) {
    return null;
  }

  const parts = match[1]
    .split('.')
    .map((part) => part.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);

  if (parts.length === 1) {
    return {
      schemaName: fallbackSchema ?? null,
      tableName: parts[0] ?? null,
    };
  }

  return {
    schemaName: parts[0] ?? fallbackSchema ?? null,
    tableName: parts[1] ?? null,
  };
}

function applyQuickFilter(rows: any[], columns: string[], quickFilter: string) {
  const normalizedFilter = quickFilter.trim().toLowerCase();

  if (!normalizedFilter) {
    return rows;
  }

  return rows.filter((row) =>
    columns.some((column) => String(row?.[column] ?? '').toLowerCase().includes(normalizedFilter)),
  );
}

function exportRowsAsCsv(columns: string[], rows: any[], baseName: string) {
  const lines = [
    columns.map(escapeCsvValue).join(','),
    ...rows.map((row) => columns.map((column) => escapeCsvValue(row?.[column])).join(',')),
  ];

  downloadTextFile(`${baseName}.csv`, lines.join('\n'), 'text/csv;charset=utf-8;');
}

function exportRowsAsJson(rows: any[], baseName: string) {
  downloadTextFile(`${baseName}.json`, JSON.stringify(rows, null, 2), 'application/json;charset=utf-8;');
}

function downloadTextFile(filename: string, contents: string, contentType: string) {
  const blob = new Blob([contents], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsvValue(value: unknown) {
  const raw = value == null ? '' : String(value);
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildExportBaseName(connectionLabel?: string) {
  const safeConnection = (connectionLabel || 'results')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${safeConnection || 'results'}-${Date.now()}`;
}

function summarizeStatementForLog(statement: string) {
  return statement
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function quoteIdentifier(name: string, engine: DatabaseEngine): string {
  if (engine === 'mysql') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteValue(value: string | null, dataType: string, engine: DatabaseEngine): string {
  if (value === null) return 'NULL';
  const type = dataType.toLowerCase();
  const isNumeric = /^(int|integer|bigint|smallint|tinyint|mediumint|numeric|decimal|float|double|real|number)/.test(type);
  const isBool = /^(bool|boolean)/.test(type);
  if (isNumeric && /^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  if (isBool && /^(true|false)$/i.test(value.trim())) return value.trim().toLowerCase();
  const escaped = engine === 'mysql'
    ? value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    : value.replace(/'/g, "''");
  return `'${escaped}'`;
}

function buildUpdateSql(
  schemaName: string | null,
  tableName: string,
  colName: string,
  newValue: string | null,
  row: Record<string, unknown>,
  pkCols: import('./../../features/database/types').MetadataColumn[],
  engine: DatabaseEngine,
): string {
  const qi = (n: string) => quoteIdentifier(n, engine);
  const tableRef = schemaName ? `${qi(schemaName)}.${qi(tableName)}` : qi(tableName);

  const setCols = pkCols.some((pk) => pk.columnName === colName)
    ? [colName]
    : [colName];

  const setClause = setCols
    .map((c) => {
      const pkCol = pkCols.find((p) => p.columnName === c);
      return `${qi(c)} = ${quoteValue(newValue, pkCol?.dataType ?? '', engine)}`;
    })
    .join(', ');

  const whereClause = pkCols
    .map((pk) => {
      const pkVal = row[pk.columnName];
      const rawPkStr = pkVal === null || pkVal === undefined ? null : String(pkVal);
      return `${qi(pk.columnName)} = ${quoteValue(rawPkStr, pk.dataType, engine)}`;
    })
    .join(' AND ');

  return `UPDATE ${tableRef} SET ${setClause} WHERE ${whereClause}`;
}

function buildDeleteSql(
  schemaName: string | null,
  tableName: string,
  row: Record<string, unknown>,
  pkCols: import('./../../features/database/types').MetadataColumn[],
  engine: DatabaseEngine,
): string {
  const qi = (n: string) => quoteIdentifier(n, engine);
  const tableRef = schemaName ? `${qi(schemaName)}.${qi(tableName)}` : qi(tableName);

  const whereClause = pkCols
    .map((pk) => {
      const pkVal = row[pk.columnName];
      const rawPkStr = pkVal === null || pkVal === undefined ? null : String(pkVal);
      return `${qi(pk.columnName)} = ${quoteValue(rawPkStr, pk.dataType, engine)}`;
    })
    .join(' AND ');

  return `DELETE FROM ${tableRef} WHERE ${whereClause}`;
}
