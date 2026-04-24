import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import PulseLoader from '../../components/ui/PulseLoader';
import type * as Monaco from 'monaco-editor';
import Editor from '@monaco-editor/react';
import { format as sqlFormat } from 'sql-formatter';
import { readText as clipboardReadText, writeText as clipboardWriteText } from '@tauri-apps/plugin-clipboard-manager';
import { useQueriesStore } from '../../store/queries';
import { type DatabaseEngine, useConnectionsStore, getConnectionColor, hexToRgba } from '../../store/connections';
import { invoke } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { ensureColumnsCached, ensureTablesCached, warmMetadataAfterConnect } from '../database/metadata-cache';
import { useDatabaseSessionStore } from '../../store/databaseSession';
import type { MetadataColumn } from '../database/types';
import {
  Plus,
  X,
  Play,
  LoaderCircle,
  Clock3,
  AlignLeft,
  Sparkles,
  AlertCircle,
  Download,
  FileJson,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  RotateCcw,
  Trash2,
  Save,
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
import { ensureConfiguredMonacoTheme, resolveConfiguredMonacoTheme } from '../../lib/monaco-theme';

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
  isAutoIncrement?: boolean;
}

interface QueryExecutionResult extends QueryResult {
  statement: string;
  title: string;
  pageCache?: Record<number, QueryResult>;
}

interface ExecuteQueryPayload {
  result: QueryResult;
  history_item_id: string;
  autocommit_enabled: boolean;
  transaction_open: boolean;
  diagnostics?: string[];
}

const SEMANTIC_SUCCESS_DURATION_MS = 3600;
const SEMANTIC_ERROR_DURATION_MS = 6200;
const SEMANTIC_WARNING_DURATION_MS = 6200;
const MIN_RUNNING_VISIBLE_MS = 450;
const CONNECTION_MENU_WIDTH = 340;
let sqlFormatterRegistered = false;

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForMinimumRunning(startedAt: number) {
  const elapsed = window.performance.now() - startedAt;
  const remaining = MIN_RUNNING_VISIBLE_MS - elapsed;
  if (remaining > 0) {
    await wait(remaining);
  }
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

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
    reorderTab,
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
  const locale = useUiPreferencesStore((state) => state.locale);
  const semanticBackgroundState = useUiPreferencesStore((state) => state.semanticBackgroundState);
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const setSemanticBackgroundState = useUiPreferencesStore((state) => state.setSemanticBackgroundState);
  const resultPageSize = useUiPreferencesStore((state) => state.resultPageSize);
  const setResultPageSize = useUiPreferencesStore((state) => state.setResultPageSize);
  const themeId = useUiPreferencesStore((state) => state.themeId);
  const monacoThemeName = useUiPreferencesStore((state) => state.monacoThemeName);
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

  const toolbarStatus: { label: string; color: string; pulse: boolean } | null = useMemo(() => {
    const tr = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    if (semanticBackgroundState === 'running') return { label: tr('statusRunning'), color: connectionColor, pulse: true };
    if (semanticBackgroundState === 'success') return { label: tr('statusSuccess'), color: '#4ade80', pulse: false };
    if (semanticBackgroundState === 'error') return { label: tr('statusError'), color: '#f87171', pulse: false };
    if (semanticBackgroundState === 'warning') return { label: tr('statusWarning'), color: '#fb923c', pulse: false };
    return null;
  }, [semanticBackgroundState, connectionColor, locale]);

  const [loading, setLoading] = useState(false);
  const [errorByTabId, setErrorByTabId] = useState<Record<string, QueryErrorPresentation | null>>({});
  const [resultsByTabId, setResultsByTabId] = useState<Record<string, QueryExecutionResult[]>>({});
  const [activeResultIndexByTabId, setActiveResultIndexByTabId] = useState<Record<string, number>>({});
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
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [exportedFormat, setExportedFormat] = useState<'csv' | 'json' | null>(null);
  const exportFeedbackRef = useRef<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedSourceRowIndex, setSelectedSourceRowIndex] = useState<number | null>(null);
  const [pendingRowEdits, setPendingRowEdits] = useState<Map<object, Record<string, string | null>>>(new Map());
  const [pendingNewRows, setPendingNewRows] = useState<Record<string, unknown>[]>([]);
  const [focusNewRowToken, setFocusNewRowToken] = useState(0);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  const [gridFullscreen, setGridFullscreen] = useState(false);
  const [activePanel, setActivePanel] = useState<'results' | 'logs'>('results');
  const editErrorTimeoutRef = useRef<number | null>(null);
  const executeQueryRef = useRef<() => void>(() => {});
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const connectionMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabDragRef = useRef<{ tabId: string; startX: number; dragging: boolean } | null>(null);
  const suppressTabClickRef = useRef(false);
  const lastCursorPositionRef = useRef<{ lineNumber: number; column: number } | null>(null);
  const autocompleteDisposableRef = useRef<{ dispose(): void } | null>(null);
  const suggestTimeoutRef = useRef<number | null>(null);
  const semanticResetTimeoutRef = useRef<number | null>(null);
  const pagePrefetchKeysRef = useRef<Set<string>>(new Set());
  const autocompleteContextRef = useRef<{
    connectionId?: string | null;
    activeSchema?: string | null;
    engine?: DatabaseEngine | null;
  }>({
    connectionId: resolvedConnectionId,
    activeSchema: schemaLabel,
    engine,
  });

  const setTabResults = useCallback((
    tabId: string | null | undefined,
    value: QueryExecutionResult[] | ((current: QueryExecutionResult[]) => QueryExecutionResult[]),
  ) => {
    if (!tabId) {
      return;
    }

    setResultsByTabId((current) => {
      const currentResults = current[tabId] ?? [];
      const nextResults = typeof value === 'function' ? value(currentResults) : value;
      return {
        ...current,
        [tabId]: nextResults,
      };
    });
  }, []);

  const setTabActiveResultIndex = useCallback((
    tabId: string | null | undefined,
    value: number | ((current: number) => number),
  ) => {
    if (!tabId) {
      return;
    }

    setActiveResultIndexByTabId((current) => {
      const currentIndex = current[tabId] ?? 0;
      const nextIndex = typeof value === 'function' ? value(currentIndex) : value;
      return {
        ...current,
        [tabId]: nextIndex,
      };
    });
  }, []);

  const setTabError = useCallback((tabId: string | null | undefined, value: QueryErrorPresentation | null) => {
    if (!tabId) {
      return;
    }

    setErrorByTabId((current) => ({
      ...current,
      [tabId]: value,
    }));
  }, []);

  const results = activeTabId ? resultsByTabId[activeTabId] ?? [] : [];
  const storedActiveResultIndex = activeTabId ? activeResultIndexByTabId[activeTabId] ?? 0 : 0;
  const activeResultIndex = results.length ? Math.min(storedActiveResultIndex, results.length - 1) : 0;
  const error = activeTabId ? errorByTabId[activeTabId] ?? null : null;

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

  useEffect(() => {
    if (!monacoRef.current) {
      return;
    }

    const editorTheme = ensureConfiguredMonacoTheme(monacoRef.current, monacoThemeName, themeId);
    monacoRef.current.editor.setTheme(editorTheme);
  }, [monacoThemeName, themeId]);

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

  const handleFormat = useCallback(() => {
    editorRef.current?.getAction('editor.action.formatDocument')?.run();
  }, []);

  const scheduleSemanticReset = useCallback((durationMs: number) => {
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
    }

    semanticResetTimeoutRef.current = window.setTimeout(() => {
      setSemanticBackgroundState('idle');
      semanticResetTimeoutRef.current = null;
    }, durationMs);
  }, [setSemanticBackgroundState]);

  const startExecutionFeedback = useCallback(() => {
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
      semanticResetTimeoutRef.current = null;
    }

    setSemanticBackgroundState('running');
    setLoading(true);
    setTabError(activeTabId, null);
    setActivePanel('results');
    return window.performance.now();
  }, [activeTabId, setSemanticBackgroundState, setTabError]);

  const syncTransactionState = useCallback((connectionId: string, payload: ExecuteQueryPayload) => {
    setAutocommitEnabled(connectionId, payload.autocommit_enabled);
    setTransactionOpen(connectionId, payload.transaction_open);
  }, [setAutocommitEnabled, setTransactionOpen]);

  const appendDiagnostics = useCallback((connectionId: string, diagnostics?: string[]) => {
    diagnostics?.forEach((entry) => appendLog(connectionId, entry));
  }, [appendLog]);

  const prefetchNextResultPage = useCallback(async ({
    tabId,
    resultIndex,
    connectionId,
    statement,
    result,
  }: {
    tabId: string | null | undefined;
    resultIndex: number;
    connectionId: string;
    statement: string;
    result: QueryResult;
  }) => {
    if (!tabId || result.page == null || result.page_size == null || result.total_rows == null) {
      return;
    }

    const nextPage = result.page + 1;
    const totalPagesForResult = Math.ceil(result.total_rows / Math.max(result.page_size, 1));
    if (nextPage > totalPagesForResult) {
      return;
    }

    const key = `${tabId}:${resultIndex}:${nextPage}:${statement}`;
    if (pagePrefetchKeysRef.current.has(key)) {
      return;
    }

    pagePrefetchKeysRef.current.add(key);
    try {
      const payload = await invoke<ExecuteQueryPayload>('execute_query', {
        connId: connectionId,
        query: statement,
        page: nextPage,
        pageSize: result.page_size,
        knownTotalRows: result.total_rows,
      });
      appendDiagnostics(connectionId, payload.diagnostics);

      setTabResults(tabId, (current) =>
        current.map((item, index) => {
          if (index !== resultIndex || item.statement !== statement) {
            return item;
          }

          return {
            ...item,
            pageCache: {
              ...(item.pageCache ?? {}),
              [nextPage]: payload.result,
            },
          };
        }),
      );
    } catch (error) {
      appendLog(connectionId, `Erro ao pre-carregar pagina ${nextPage}: ${extractErrorMessage(error).trim()}`);
    } finally {
      pagePrefetchKeysRef.current.delete(key);
    }
  }, [appendDiagnostics, appendLog, setTabResults]);

  const runQueryBatch = useCallback(async (queries: string[], connectionId: string, options?: { feedbackStartedAt?: number; tabId?: string | null }) => {
    const statements = queries.map((item) => item.trim()).filter(Boolean);
    if (!statements.length || !connectionId) {
      if (options?.feedbackStartedAt) {
        setLoading(false);
        setSemanticBackgroundState('idle');
      }
      return;
    }
    const targetConnection = connections.find((item) => item.id === connectionId) ?? null;
    const targetEngine = targetConnection?.engine;
    const targetSchema = activeSchemaByConnection[connectionId] ?? targetConnection?.preferredSchema;
    const targetTabId = options?.tabId ?? activeTabId;
    
    const runningStartedAt = options?.feedbackStartedAt ?? startExecutionFeedback();
    if (!options?.feedbackStartedAt) {
      await waitForNextPaint();
    }

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
        appendDiagnostics(connectionId, payload.diagnostics);

        nextResults.push({
          ...payload.result,
          statement,
          title: `Result ${index + 1}`,
          pageCache: payload.result.page ? { [payload.result.page]: payload.result } : undefined,
        });

        void prefetchNextResultPage({
          tabId: targetTabId,
          resultIndex: index,
          connectionId,
          statement,
          result: payload.result,
        });

        appendLog(
          connectionId,
          `Query executada com sucesso (${payload.result.execution_time}ms): ${summarizeStatementForLog(statement)}`,
        );

        const sourceTable = resolveSimpleSourceTable(statement, targetSchema ?? null);
        if (sourceTable?.tableName && targetEngine) {
          const schemaForFetch = sourceTable.schemaName ?? targetSchema ?? null;
          if (schemaForFetch) {
            void ensureColumnsCached(connectionId, targetEngine, schemaForFetch, sourceTable.tableName, { priority: true }).catch(() => null);
          }
        }
      }

      setTabResults(targetTabId, nextResults);
      setTabActiveResultIndex(targetTabId, 0);
      await waitForMinimumRunning(runningStartedAt);
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
      setTabError(targetTabId, nextError);
      appendLog(connectionId, `Erro de query: ${extractErrorMessage(e).trim()}`);
      await waitForMinimumRunning(runningStartedAt);
      setSemanticBackgroundState('error');
      scheduleSemanticReset(SEMANTIC_ERROR_DURATION_MS);
    } finally {
      setLoading(false);
    }
  }, [activeSchemaByConnection, activeTabId, appendDiagnostics, appendLog, connections, metadataByConnection, prefetchNextResultPage, resultPageSize, scheduleSemanticReset, setSemanticBackgroundState, setTabActiveResultIndex, setTabError, setTabResults, startExecutionFeedback]);

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
      appendLog(connectionId, t('connectionOpenedSuccessfully'));
      void warmMetadataAfterConnect(connectionId, connection.engine).catch(() => null);
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

    const runningStartedAt = startExecutionFeedback();
    await waitForNextPaint();

    try {
      await ensureExecutionConnectionReady(resolvedConnectionId);
      await runQueryBatch(statements, resolvedConnectionId, { feedbackStartedAt: runningStartedAt, tabId: activeTabId });
    } catch (executionError) {
      const connection = connections.find((item) => item.id === resolvedConnectionId) ?? null;
      appendLog(resolvedConnectionId, `Erro de query: ${extractErrorMessage(executionError).trim()}`);
      setTabError(
        activeTabId,
        buildQueryErrorPresentation({
          error: executionError,
          engine: connection?.engine ?? engine,
          statement: statements[0] ?? null,
          activeSchema: activeSchemaByConnection[resolvedConnectionId] ?? connection?.preferredSchema ?? schemaLabel,
          metadataConnection: metadataByConnection[resolvedConnectionId],
        }),
      );
      await waitForMinimumRunning(runningStartedAt);
      setSemanticBackgroundState('error');
      scheduleSemanticReset(SEMANTIC_ERROR_DURATION_MS);
      setLoading(false);
    }
  }, [
    activeSchemaByConnection,
    activeTabId,
    appendLog,
    connections,
    engine,
    ensureExecutionConnectionReady,
    metadataByConnection,
    resolvedConnectionId,
    runQueryBatch,
    scheduleSemanticReset,
    schemaLabel,
    setSemanticBackgroundState,
    setTabError,
    startExecutionFeedback,
  ]);

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
      setTabError(activeTabId, {
        title: 'Falha ao abrir o histórico',
        summary: 'A conexão salva para este item de histórico não existe mais.',
        technicalMessage: 'A configuração da conexão vinculada ao item de histórico não foi encontrada.',
        suggestions: [],
      });
      return;
    }

    const targetTabId = replaceCurrent
      ? replaceActiveTabContent(item.queryText, deriveHistoryTabTitle(item.queryText), item.connectionId)
      : addTabWithContent(item.queryText, deriveHistoryTabTitle(item.queryText), item.connectionId);

    const runningStartedAt = startExecutionFeedback();
    await waitForNextPaint();

    try {
      await ensureExecutionConnectionReady(connection.id);
      await runQueryBatch(splitSqlStatements(item.queryText), connection.id, { feedbackStartedAt: runningStartedAt, tabId: targetTabId });
    } catch (runError) {
      setTabError(
        targetTabId,
        buildQueryErrorPresentation({
          error: runError,
          engine: connection.engine,
          statement: item.queryText,
          activeSchema: connection.preferredSchema ?? schemaLabel,
        }),
      );
      await waitForMinimumRunning(runningStartedAt);
      setSemanticBackgroundState('error');
      scheduleSemanticReset(SEMANTIC_ERROR_DURATION_MS);
      setLoading(false);
    }
  }, [
    addTabWithContent,
    activeTabId,
    connections,
    ensureExecutionConnectionReady,
    replaceActiveTabContent,
    runQueryBatch,
    scheduleSemanticReset,
    schemaLabel,
    setSemanticBackgroundState,
    setTabError,
    startExecutionFeedback,
  ]);

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
    setTabResults(activeTabId, (current) => {
      const next = current.filter((_, index) => index !== indexToClose);

      setTabActiveResultIndex(activeTabId, (currentIndex) => {
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
  }, [activeTabId, setTabActiveResultIndex, setTabResults]);

  const loadResultPage = useCallback(async (resultIndex: number, nextPage: number) => {
    const targetResult = results[resultIndex];
    if (!targetResult || !resolvedConnectionId) {
      return;
    }
    const targetTabId = activeTabId;
    const cachedPage = targetResult.pageCache?.[nextPage];
    if (cachedPage) {
      setTabResults(targetTabId, (current) =>
        current.map((item, index) =>
          index === resultIndex
            ? {
                ...cachedPage,
                statement: item.statement,
                title: item.title,
                pageCache: item.pageCache,
              }
            : item,
        ),
      );
      setTabActiveResultIndex(targetTabId, resultIndex);
      void prefetchNextResultPage({
        tabId: targetTabId,
        resultIndex,
        connectionId: resolvedConnectionId,
        statement: targetResult.statement,
        result: cachedPage,
      });
      return;
    }

    setLoading(true);
    setTabError(targetTabId, null);

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
      appendDiagnostics(resolvedConnectionId, payload.diagnostics);

      setTabResults(targetTabId, (current) =>
        current.map((item, index) =>
          index === resultIndex
            ? {
                ...payload.result,
                statement: item.statement,
                title: item.title,
                pageCache: {
                  ...(item.pageCache ?? {}),
                  [nextPage]: payload.result,
                },
              }
            : item,
        ),
      );
      setTabActiveResultIndex(targetTabId, resultIndex);
      void prefetchNextResultPage({
        tabId: targetTabId,
        resultIndex,
        connectionId: resolvedConnectionId,
        statement: targetResult.statement,
        result: payload.result,
      });
    } catch (pageError) {
      appendLog(resolvedConnectionId, `Erro ao carregar pagina: ${extractErrorMessage(pageError).trim()}`);
      setTabError(
        targetTabId,
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
  }, [activeTabId, appendDiagnostics, appendLog, ensureExecutionConnectionReady, engine, metadataByConnection, prefetchNextResultPage, resolvedConnectionId, resultPageSize, results, schemaLabel, setTabActiveResultIndex, setTabError, setTabResults]);

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

  const pkCols = cachedSourceColumns?.filter((c) => c.isPrimaryKey) ?? [];
  const canEditGrid = !!activeSourceTable && pkCols.length > 0;
  const hasPendingChanges = pendingRowEdits.size > 0 || pendingNewRows.length > 0;

  useEffect(() => {
    setSelectedSourceRowIndex(null);
    setPendingRowEdits(new Map());
    setPendingNewRows([]);
  }, [activeResultIndex, resolvedConnectionId, activeResult?.statement, activeTabId]);

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

    void ensureColumnsCached(resolvedConnectionId, engine, activeSourceTable.schemaName, activeSourceTable.tableName, { priority: true }).catch(() => null);
  }, [activeSourceTable, cachedSourceColumns, engine, resolvedConnectionId, runtimeStatus]);

  const applyPageSize = useCallback(async () => {
    const parsed = Number(pageSizeDraft);
    const normalized = Math.min(1000, Math.max(1, Number.isFinite(parsed) ? Math.round(parsed) : resultPageSize));
    setPageSizeDraft(String(normalized));
    setResultPageSize(normalized);

    if (!activeResult || !resolvedConnectionId) {
      return;
    }
    const targetTabId = activeTabId;

    setLoading(true);
    setTabError(targetTabId, null);

    try {
      await ensureExecutionConnectionReady(resolvedConnectionId);
      const payload = await invoke<ExecuteQueryPayload>('execute_query', {
        connId: resolvedConnectionId,
        query: activeResult.statement,
        page: 1,
        pageSize: normalized,
      });
      syncTransactionState(resolvedConnectionId, payload);
      appendDiagnostics(resolvedConnectionId, payload.diagnostics);

      setTabResults(targetTabId, (current) =>
        current.map((item, index) =>
          index === activeResultIndex
            ? {
                ...payload.result,
                statement: item.statement,
                title: item.title,
                pageCache: payload.result.page ? { [payload.result.page]: payload.result } : undefined,
              }
            : item,
        ),
      );
    } catch (pageSizeError) {
      appendLog(resolvedConnectionId, `Erro ao aplicar limite de linhas: ${extractErrorMessage(pageSizeError).trim()}`);
      setTabError(
        targetTabId,
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
  }, [activeResult, activeResultIndex, activeTabId, appendDiagnostics, appendLog, ensureExecutionConnectionReady, engine, metadataByConnection, pageSizeDraft, resolvedConnectionId, resultPageSize, schemaLabel, setResultPageSize, setTabError, setTabResults]);

  const handleCellChange = useCallback((
    colName: string,
    _rowIndex: number,
    newValue: string | null,
    row: Record<string, unknown>,
  ) => {
    setPendingRowEdits((current) => {
      const next = new Map(current);
      const existing = next.get(row) ?? {};
      next.set(row, { ...existing, [colName]: newValue });
      return next;
    });
  }, []);

  const handleAddNewRow = useCallback(() => {
    if (!activeResult) return;
    const emptyRow = Object.fromEntries(activeResult.columns.map((c) => [c, null]));
    setPendingNewRows((current) => [...current, emptyRow]);
    setFocusNewRowToken((t) => t + 1);
  }, [activeResult]);

  const handleSaveChanges = useCallback(async () => {
    if (!resolvedConnectionId || !activeSourceTable?.tableName || !activeResult) return;
    if (!canEditGrid && pendingNewRows.length === 0) return;

    setLoading(true);
    setSaveError(null);
    const targetTabId = activeTabId;

    try {
      await ensureExecutionConnectionReady(resolvedConnectionId);

      for (const [row, changes] of pendingRowEdits.entries()) {
        if (!pkCols.length) continue;
        const sql = buildMultiColUpdateSql(
          activeSourceTable.schemaName,
          activeSourceTable.tableName,
          changes,
          row as Record<string, unknown>,
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
        appendDiagnostics(resolvedConnectionId, payload.diagnostics);
      }

      for (const newRow of pendingNewRows) {
        const sql = buildInsertSql(
          activeSourceTable.schemaName,
          activeSourceTable.tableName,
          newRow,
          activeResult.column_meta ?? [],
          engine ?? 'postgres',
        );
        const payload = await invoke<ExecuteQueryPayload>('execute_query', {
          connId: resolvedConnectionId,
          query: sql,
          page: 1,
          pageSize: 1,
        });
        syncTransactionState(resolvedConnectionId, payload);
        appendDiagnostics(resolvedConnectionId, payload.diagnostics);
      }

      setTabResults(targetTabId, (current) =>
        current.map((item, idx) => {
          if (idx !== activeResultIndex) return item;
          const updatedRows = item.rows.map((r) => {
            const changes = pendingRowEdits.get(r as object);
            return changes ? { ...r, ...changes } : r;
          });
          return {
            ...item,
            rows: [...updatedRows, ...pendingNewRows],
            total_rows: typeof item.total_rows === 'number'
              ? item.total_rows + pendingNewRows.length
              : item.total_rows,
          };
        }),
      );

      setPendingRowEdits(new Map());
      setPendingNewRows([]);
      setHistoryRefreshToken((current) => current + 1);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
      if (editErrorTimeoutRef.current) window.clearTimeout(editErrorTimeoutRef.current);
      editErrorTimeoutRef.current = window.setTimeout(() => {
        setSaveError(null);
        
      }, 3500);
    } finally {
      setLoading(false);
    }
  }, [
    resolvedConnectionId,
    activeSourceTable,
    activeResult,
    canEditGrid,
    pendingRowEdits,
    pendingNewRows,
    pkCols,
    activeTabId,
    activeResultIndex,
    engine,
    appendDiagnostics,
    ensureExecutionConnectionReady,
    syncTransactionState,
    setTabResults,
  ]);

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
      setSaveError('No primary key detected — cannot safely delete this row.');
      if (editErrorTimeoutRef.current) window.clearTimeout(editErrorTimeoutRef.current);
      editErrorTimeoutRef.current = window.setTimeout(() => {
        setSaveError(null);
      }, 3500);
      return;
    }

    const row = activeResult.rows[selectedSourceRowIndex] as Record<string, unknown>;
    setSaveError(null);
    const targetTabId = activeTabId;

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
      appendDiagnostics(resolvedConnectionId, payload.diagnostics);

      setHistoryRefreshToken((current) => current + 1);
      setTabResults(targetTabId, (current) =>
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
      setSaveError(msg);
      if (editErrorTimeoutRef.current) window.clearTimeout(editErrorTimeoutRef.current);
      editErrorTimeoutRef.current = window.setTimeout(() => {
        setSaveError(null);
      }, 3500);
    }
  }, [
    activeResult,
    activeResultIndex,
    activeSourceTable,
    activeTabId,
    appendDiagnostics,
    cachedSourceColumns,
    engine,
    ensureExecutionConnectionReady,
    resolvedConnectionId,
    selectedSourceRowIndex,
    setTabResults,
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
    appendDiagnostics(resolvedConnectionId, payload.diagnostics);
    setTabResults(activeTabId, [
      {
        ...payload.result,
        statement: action,
        title: t('result'),
      },
    ]);
    setTabActiveResultIndex(activeTabId, 0);
    setHistoryRefreshToken((current) => current + 1);
  }, [activeTabId, appendDiagnostics, ensureExecutionConnectionReady, resolvedConnectionId, setTabActiveResultIndex, setTabResults, syncTransactionState, t]);

  const handleConnectionChange = useCallback((nextConnectionId: string) => {
    if (!activeTab) {
      return;
    }

    const normalizedConnectionId = nextConnectionId || null;
    setTabConnection(activeTab.id, normalizedConnectionId);
    setActiveConnection(normalizedConnectionId);
    setConnectionMenuOpen(false);
  }, [activeTab, setActiveConnection, setTabConnection]);

  const openConnectionMenu = useCallback((rect: DOMRect) => {
    setConnectionMenuPosition({
      x: Math.round(Math.max(8, Math.min(rect.right - CONNECTION_MENU_WIDTH, window.innerWidth - CONNECTION_MENU_WIDTH - 8))),
      y: Math.round(Math.min(rect.bottom + 8, window.innerHeight - 220)),
    });
    setConnectionMenuOpen((current) => !current);
  }, []);

  const handleTabPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>, tabId: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }

    tabDragRef.current = { tabId, startX: event.clientX, dragging: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleTabPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = tabDragRef.current;
    if (!drag) {
      return;
    }

    if (!drag.dragging && Math.abs(event.clientX - drag.startX) < 5) {
      return;
    }

    drag.dragging = true;
    suppressTabClickRef.current = true;
    setDraggedTabId(drag.tabId);

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-query-tab-id]');
    const targetTabId = target?.dataset.queryTabId;

    if (!targetTabId || targetTabId === drag.tabId) {
      return;
    }

    setDragOverTabId(targetTabId);
    const fromIndex = tabs.findIndex((tab) => tab.id === drag.tabId);
    const toIndex = tabs.findIndex((tab) => tab.id === targetTabId);

    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      reorderTab(fromIndex, toIndex);
    }
  }, [reorderTab, tabs]);

  const handleTabPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (tabDragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    tabDragRef.current = null;
    setDraggedTabId(null);
    setDragOverTabId(null);

    window.setTimeout(() => {
      suppressTabClickRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    if (!activeTab || activeTab.connectionId !== undefined || !activeConnectionId) {
      return;
    }

    setTabConnection(activeTab.id, activeConnectionId);
  }, [activeConnectionId, activeTab, setTabConnection]);

  const renderResultsPanel = (fullscreen = false) => (
    <div
      className={`border-border/80 flex flex-col relative overflow-hidden ${
        fullscreen
          ? 'h-full min-h-0 border'
          : 'min-h-[190px] max-h-[58%] shrink-0 flex-grow-0 border-t max-[720px]:h-[40%]'
      }`}
      style={fullscreen ? { background: 'rgba(var(--bt-background-rgb), 0.92)' } : { height: `${resultsHeight}%`, background: 'rgba(var(--bt-background-rgb), 0.92)' }}
    >
      <div
        className="flex items-center gap-2 border-b border-border/80 px-3 overflow-hidden"
        style={{ background: 'rgba(var(--bt-surface-rgb), 0.64)', paddingTop: 8, paddingBottom: 8 }}
      >
        {/* Pill tabs */}
        <div style={{ display: 'flex', gap: 2, padding: 2, background: 'rgba(var(--bt-background-rgb), 0.72)', borderRadius: 7, border: '1px solid var(--bt-border)', flexShrink: 0 }}>
          {(results.length ? results : [{ title: t('result') } as QueryExecutionResult]).map((item, index) => (
            <div key={`${item.title}-${index}`} className="inline-flex items-center">
              <button
                onClick={() => { setTabActiveResultIndex(activeTabId, index); setActivePanel('results'); }}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition-colors"
                style={activePanel === 'results' && activeResultIndex === index
                  ? { background: hexToRgba(connectionColor, 0.055), color: 'var(--bt-text)', border: `1px solid ${hexToRgba(connectionColor, 0.18)}` }
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
              ? { background: hexToRgba(connectionColor, 0.055), color: 'var(--bt-text)', border: `1px solid ${hexToRgba(connectionColor, 0.18)}` }
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

        {activeResult && hasGridResult ? (
          <div className="flex flex-1 items-center min-w-0">

            {/* Container 1 — início: + e salvar */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleAddNewRow}
                disabled={!canEditGrid || loading}
                className="inline-flex items-center rounded-lg border border-border/70 px-2 py-1.5 text-xs text-muted transition-colors hover:bg-border/30 hover:text-text disabled:cursor-not-allowed disabled:opacity-35"
                title={t('addRow')}
              >
                <Plus size={13} />
              </button>
              <button
                type="button"
                onClick={() => void handleSaveChanges()}
                disabled={!hasPendingChanges || loading}
                className={`inline-flex items-center rounded-lg border px-2 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                  hasPendingChanges
                    ? 'border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/18'
                    : 'border-border/70 text-muted hover:bg-border/30 hover:text-text'
                }`}
                title={t('saveChanges')}
              >
                <Save size={13} />
              </button>
            </div>

            {/* Container 2 — centro: stats, transação, paginação, filtro, fullscreen, exports */}
            <div className="flex flex-1 items-center justify-center gap-2 min-w-0 px-2">
              <div className="hidden md:flex items-center gap-1.5 text-xs shrink-0" style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--bt-muted)' }}>
                <>
                  <span style={{ color: 'var(--bt-muted)' }}>✓</span>
                  <span>
                    {formatNumber(locale, filteredRows.length)}
                    {' / '}
                    {formatNumber(locale, quickFilter ? activeResult.rows.length : totalRows)}
                    {quickFilter && totalRows !== activeResult.rows.length ? ` / ${formatNumber(locale, totalRows)}` : ''}
                    {' '}
                    {t('rowsLabel')}
                  </span>
                  {canPaginate ? (
                    <>
                      <span style={{ opacity: 0.4 }}>│</span>
                      <span>{t('pageOf', { page: currentPage, total: totalPages })}</span>
                    </>
                  ) : null}
                  <span style={{ opacity: 0.4 }}>│</span>
                </>
                <span style={{ color: 'var(--bt-muted)' }}>{activeResult.execution_time}ms</span>
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
              <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/30 px-2.5 py-1.5 min-w-[160px] md:min-w-[200px]">
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
            </div>

            {/* Container 3 — fim: lixeira colada na borda */}
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => void handleDeleteSelectedRow()}
                disabled={selectedSourceRowIndex == null || loading}
                className="inline-flex items-center rounded-lg border border-red-400/25 px-2 py-1.5 text-xs text-red-300/70 transition-colors hover:bg-red-400/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-35"
                title={t('deleteSelectedRow')}
              >
                <Trash2 size={13} />
              </button>
            </div>

          </div>
        ) : activeResult ? (
          <div className="flex flex-1 items-center justify-end gap-2 min-w-0">
            <div className="hidden md:flex items-center gap-1.5 text-xs shrink-0" style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--bt-muted)' }}>
              <span style={{ color: 'var(--bt-muted)' }}>{activeResult.execution_time}ms</span>
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
          </div>
        ) : null}
      </div>

      {saveError ? (
        <div className="flex items-center gap-2 border-b border-red-400/25 bg-red-400/8 px-4 py-2 text-xs text-red-300">
          <AlertCircle size={12} className="shrink-0" />
          {saveError}
        </div>
      ) : null}
      <div className="flex-1 overflow-auto bg-background/10 relative">
        {activePanel === 'logs' ? (
          <div className="h-full overflow-y-auto p-3" style={{ fontFamily: 'ui-monospace, "SF Mono", monospace', fontSize: 11.5 }}>
            {resolvedConnectionId && connectionLogs[resolvedConnectionId]?.length ? (
              connectionLogs[resolvedConnectionId].map((entry, i) => {
                const tone = resolveLogTone(entry);
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2 border-b border-border/25 py-1.5 last:border-0"
                    style={{ color: tone.text, lineHeight: 1.6 }}
                  >
                    <span
                      className="w-[72px] shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: tone.label }}
                    >
                      [{tone.kind}]
                    </span>
                    <span className="min-w-0 flex-1 break-words">{entry}</span>
                  </div>
                );
              })
            ) : (
              <div className="flex h-full items-center justify-center text-muted/50 text-sm" style={{ fontFamily: 'inherit' }}>
                Nenhum log registrado para esta conexão.
              </div>
            )}
          </div>
        ) : null}
        {activePanel === 'results' && loading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/55">
            <PulseLoader
              color={connectionColor}
              message={t('loadingResults')}
              size="md"
              surface="card"
            />
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
                  onCellChange={canEditGrid ? handleCellChange : undefined}
                  pendingRowEdits={pendingRowEdits}
                  pendingNewRows={canEditGrid ? pendingNewRows : undefined}
                  focusNewRowToken={canEditGrid ? focusNewRowToken : undefined}
                  selectedRowIndex={selectedDisplayRowIndex}
                  onRowSelect={handleRowSelect}
                />
              ) : activeResult.summary ? null : (
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
      <div className="sql-workspace-shell">
        <div className="relative z-10 flex h-full min-h-0 flex-col">
          <div className="shrink-0 overflow-hidden">
            <div
              className="flex items-stretch border-b border-border/80"
              style={{
                background: 'rgba(var(--bt-background-rgb), 0.96)',
              }}
            >
              <div className="flex flex-1 min-w-0 items-stretch overflow-x-auto scrollbar-hide">
                {tabs.map(tab => {
                  const tabColor = getConnectionColor(connections, tab.connectionId ?? activeConnectionId);
                  const isActiveTab = activeTabId === tab.id;
                  const isDraggedTab = draggedTabId === tab.id;
                  const isDragOverTab = dragOverTabId === tab.id && !isDraggedTab;
                  return (
                  <div
                    key={tab.id}
                    data-query-tab-id={tab.id}
                    onClick={() => {
                      if (suppressTabClickRef.current) {
                        return;
                      }
                      setActiveTab(tab.id);
                    }}
                    onPointerDown={(event) => handleTabPointerDown(event, tab.id)}
                    onPointerMove={handleTabPointerMove}
                    onPointerUp={handleTabPointerUp}
                    onPointerCancel={handleTabPointerUp}
                    className={`group relative flex min-w-[108px] max-w-[178px] cursor-grab touch-none select-none items-center gap-1.5 px-2.5 py-1.5 transition-all active:cursor-grabbing ${
                      isActiveTab ? 'text-text' : 'text-muted hover:bg-white/4'
                    }`}
                    style={{
                      background: isActiveTab ? 'rgba(var(--bt-surface-rgb), 0.62)' : 'transparent',
                      borderTop: isActiveTab ? `1px solid ${hexToRgba(tabColor, 0.18)}` : '1px solid transparent',
                      borderRight: isActiveTab ? `1px solid var(--bt-border)` : '1px solid var(--bt-border)',
                      borderBottom: isActiveTab ? '1px solid rgba(var(--bt-surface-rgb), 0.62)' : '1px solid transparent',
                      borderLeft: isDragOverTab ? `1px solid ${hexToRgba(tabColor, 0.28)}` : '1px solid transparent',
                      borderTopLeftRadius: isActiveTab ? 5 : 0,
                      borderTopRightRadius: isActiveTab ? 5 : 0,
                      boxShadow: isActiveTab ? `inset 0 1px 0 ${hexToRgba(tabColor, 0.12)}` : undefined,
                      opacity: isDraggedTab ? 0.48 : 1,
                    }}
                  >
                    <span style={{ width: 4, height: 4, borderRadius: 999, flexShrink: 0, background: tabColor, opacity: isActiveTab ? 0.58 : 0.28 }} />
                    <span className="truncate flex-1 text-[12px] leading-5">{tab.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                      onPointerDown={(event) => event.stopPropagation()}
                      className={`rounded p-0.5 text-muted transition-opacity hover:bg-border/40 flex-shrink-0 ${
                        activeTabId === tab.id ? 'opacity-55 hover:opacity-100' : 'opacity-0 group-hover:opacity-80'
                      }`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  );
                })}
                <button
                  onClick={() => addTab(resolvedConnectionId)}
                  className="flex items-center px-2 text-muted hover:text-text transition-colors"
                  style={{ borderBottom: '1px solid var(--bt-border)', minWidth: 30, paddingTop: 6, paddingBottom: 6 }}
                  title={t('newQueryTab')}
                >
                  <Plus size={13} />
                </button>
              </div>
              <button
                ref={connectionMenuButtonRef}
                type="button"
                onClick={(e) => openConnectionMenu(e.currentTarget.getBoundingClientRect())}
                className="shrink-0 flex items-center gap-1.5 border-l border-border/60 px-2.5 text-muted hover:text-text transition-colors"
                style={{
                  borderBottom: connectionMenuOpen ? `1px solid ${hexToRgba(connectionColor, 0.24)}` : '1px solid transparent',
                  background: connectionMenuOpen ? hexToRgba(connectionColor, 0.035) : undefined,
                  color: connectionMenuOpen ? 'var(--bt-text)' : undefined,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: 999, flexShrink: 0, background: connectionColor, opacity: 0.58 }} />
                <span className="text-[10px] uppercase tracking-[0.08em] truncate max-w-[150px]">
                  {selectedConnection
                    ? `${selectedConnection.engine.toUpperCase()} · ${selectedConnection.name}`
                    : t('noActiveConnection')}
                </span>
                <ChevronDown size={11} className={`shrink-0 transition-transform ${connectionMenuOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>

            <div
              className="flex flex-wrap items-center gap-2 px-3 py-2.5"
              style={{
                background: 'rgba(var(--bt-surface-rgb), 0.72)',
                borderBottom: '1px solid var(--bt-border)',
              }}
            >
              <button
                onClick={() => void executeQuery()}
                disabled={loading || !activeTab || !resolvedConnectionId}
                className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-bold transition-all ${
                  loading ? 'cursor-wait opacity-100' : 'disabled:cursor-not-allowed disabled:opacity-40'
                }`}
                style={{
                  background: connectionColor,
                  color: '#041014',
                  border: `1px solid ${hexToRgba(connectionColor, 0.78)}`,
                  letterSpacing: 0.2,
                  boxShadow: `0 0 18px ${hexToRgba(connectionColor, 0.22)}, inset 0 1px 0 rgba(255,255,255,0.2)`,
                }}
              >
                {loading
                  ? <LoaderCircle size={14} className="animate-spin" style={{ color: '#041014', opacity: 0.82 }} />
                  : <Play size={14} style={{ fill: '#041014', color: '#041014', opacity: 0.82 }} />
                }
                {loading ? t('statusRunning') : t('run')}
                <span style={{ opacity: 0.5, fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>⌘↵</span>
              </button>

              <button
                type="button"
                onClick={toggleHistory}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  background: historyOpen ? hexToRgba(connectionColor, 0.055) : 'var(--bt-surface)',
                  border: `1px solid ${historyOpen ? hexToRgba(connectionColor, 0.22) : 'var(--bt-border)'}`,
                  color: historyOpen ? 'var(--bt-text)' : 'var(--bt-muted)',
                }}
              >
                <Clock3 size={13} />
                {t('history')}
              </button>

              <button
                type="button"
                onClick={handleFormat}
                disabled={!activeTab}
                className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  background: 'var(--bt-surface)',
                  border: '1px solid var(--bt-border)',
                  color: 'var(--bt-muted)',
                }}
              >
                <AlignLeft size={13} />
                {t('format')}
              </button>

              <button
                type="button"
                disabled
                title={t('explainComingSoon')}
                className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium opacity-40"
                style={{
                  background: 'var(--bt-surface)',
                  border: '1px solid var(--bt-border)',
                  color: 'var(--bt-muted)',
                }}
              >
                <Sparkles size={13} />
                {t('explain')}
              </button>

              {toolbarStatus ? (
                <span
                  className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] transition-colors${toolbarStatus.pulse ? ' animate-pulse' : ''}`}
                  style={{
                    borderColor: hexToRgba(toolbarStatus.color, 0.22),
                    background: hexToRgba(toolbarStatus.color, 0.055),
                    color: 'var(--bt-muted)',
                  }}
                >
                  {toolbarStatus.label}
                </span>
              ) : null}
            </div>
          </div>

          {(() => {
            const effectiveGlowState = semanticBackgroundEnabled ? semanticBackgroundState : 'idle';
            const editorGlow = buildEditorGlow(effectiveGlowState, connectionColor);
            return (
          <div
            className={`flex-1 relative min-h-0 flex flex-col overflow-hidden bg-background/18 ${effectiveGlowState === 'running' ? 'editor-glow-running' : ''}`}
            style={{
              borderLeft: `2px solid ${editorGlow.borderColor}`,
              boxShadow: editorGlow.boxShadow,
              transition: 'box-shadow 400ms ease, border-left-color 300ms ease',
            }}
          >
            {activeTab ? (
              <div className="flex-1 min-h-[220px] overflow-hidden bg-background/30">
                <Editor
                  height="100%"
                  language="sql"
                  theme={resolveConfiguredMonacoTheme(monacoThemeName, themeId)}
                  value={activeTab.content}
                  onChange={(val) => updateTabContent(activeTab.id, val || "")}
                  beforeMount={(monaco) => {
                    ensureConfiguredMonacoTheme(monaco, monacoThemeName, themeId);
                    if (!sqlFormatterRegistered) {
                      monaco.languages.registerDocumentFormattingEditProvider('sql', {
                        provideDocumentFormattingEdits(model: import('monaco-editor').editor.ITextModel) {
                          try {
                            const formatted = sqlFormat(model.getValue(), { language: 'sql', tabWidth: 2 });
                            return [{ range: model.getFullModelRange(), text: formatted }];
                          } catch {
                            return [];
                          }
                        },
                      });
                      sqlFormatterRegistered = true;
                    }
                  }}
                  options={{
                    minimap: { enabled: true },
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
                    monacoRef.current = monaco;
                    monaco.editor.setTheme(ensureConfiguredMonacoTheme(monaco, monacoThemeName, themeId));
                    // Tauri WKWebView blocks navigator.clipboard; intercept copy/cut/paste
                    // via onKeyDown and use the official Tauri clipboard plugin.
                    editor.onKeyDown((e) => {
                      const model = editor.getModel();
                      const sel = editor.getSelection();
                      if (!model || !sel) return;

                      if (e.keyCode === monaco.KeyCode.KeyC && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        const text = sel.isEmpty()
                          ? model.getLineContent(sel.startLineNumber)
                          : model.getValueInRange(sel);
                        void clipboardWriteText(text);
                      } else if (e.keyCode === monaco.KeyCode.KeyX && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (sel.isEmpty()) {
                          const line = sel.startLineNumber;
                          void clipboardWriteText(model.getLineContent(line));
                          editor.pushUndoStop();
                          editor.executeEdits('cut', [{
                            range: new monaco.Range(line, 1, line + 1, 1),
                            text: '',
                            forceMoveMarkers: true,
                          }]);
                          editor.pushUndoStop();
                        } else {
                          void clipboardWriteText(model.getValueInRange(sel));
                          editor.pushUndoStop();
                          editor.executeEdits('cut', [{ range: sel, text: '', forceMoveMarkers: true }]);
                          editor.pushUndoStop();
                        }
                      } else if (e.keyCode === monaco.KeyCode.KeyV && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        void clipboardReadText().then((text) => {
                          if (!text) return;
                          editor.pushUndoStop();
                          editor.executeEdits('paste', [{ range: sel, text, forceMoveMarkers: true }]);
                          editor.pushUndoStop();
                        });
                      }
                    });
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
                    editor.addAction({
                      id: 'pulsesql.triggerAutocomplete',
                      label: 'Abrir autocomplete',
                      keybindings: [
                        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
                        monaco.KeyMod.WinCtrl | monaco.KeyCode.Space,
                      ],
                      run: () => {
                        editor.trigger('pulsesql', 'editor.action.triggerSuggest', {});
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
            );
          })()}

          {!gridFullscreen ? (
            <>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize results panel"
                onPointerDown={() => setResultsResizing(true)}
                className="shrink-0"
              >
                <div className={`h-1 cursor-row-resize transition-colors ${
                  resultsResizing ? 'bg-primary/40' : 'bg-border/40 hover:bg-primary/25'
                }`}>
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
        activeConnectionId={resolvedConnectionId}
        activeConnectionName={selectedConnection?.name ?? null}
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

type LogTone = {
  kind: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';
  label: string;
  text: string;
};

function resolveLogTone(entry: string): LogTone {
  const normalized = entry.toLowerCase();

  if (
    normalized.includes('erro') ||
    normalized.includes('error') ||
    normalized.includes('failed') ||
    normalized.includes('falha') ||
    normalized.includes('exception') ||
    normalized.includes('timeout')
  ) {
    return {
      kind: 'ERROR',
      label: '#FCA5A5',
      text: '#FECACA',
    };
  }

  if (
    normalized.includes('warn') ||
    normalized.includes('warning') ||
    normalized.includes('retry') ||
    normalized.includes('tentativa') ||
    normalized.includes('reconnecting') ||
    normalized.includes('reconectando')
  ) {
    return {
      kind: 'WARN',
      label: '#FCD34D',
      text: '#FDE68A',
    };
  }

  if (
    normalized.includes('sucesso') ||
    normalized.includes('success') ||
    normalized.includes('opened successfully') ||
    normalized.includes('connection opened') ||
    normalized.includes('restored') ||
    normalized.includes('copied')
  ) {
    return {
      kind: 'SUCCESS',
      label: '#86EFAC',
      text: '#BBF7D0',
    };
  }

  return {
    kind: 'INFO',
    label: '#7DD3FC',
    text: 'var(--bt-muted)',
  };
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
  let dollarQuoteTag: string | null = null;

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

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        current += currentChar;
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

    if (!inSingleQuote && !inDoubleQuote && currentChar === '$') {
      const tag = readDollarQuoteTag(sql, index);
      if (tag) {
        current += tag;
        index += tag.length - 1;
        dollarQuoteTag = tag;
        continue;
      }
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

function readDollarQuoteTag(sql: string, start: number): string | null {
  const match = sql.slice(start).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
  return match?.[0] ?? null;
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
      isAutoIncrement: metadataMatch?.isAutoIncrement === true,
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

function buildMultiColUpdateSql(
  schemaName: string | null,
  tableName: string,
  changes: Record<string, string | null>,
  row: Record<string, unknown>,
  pkCols: import('./../../features/database/types').MetadataColumn[],
  engine: DatabaseEngine,
): string {
  const qi = (n: string) => quoteIdentifier(n, engine);
  const tableRef = schemaName ? `${qi(schemaName)}.${qi(tableName)}` : qi(tableName);

  const setClause = Object.entries(changes)
    .map(([col, val]) => {
      const meta = pkCols.find((p) => p.columnName === col);
      return `${qi(col)} = ${quoteValue(val, meta?.dataType ?? '', engine)}`;
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

function buildInsertSql(
  schemaName: string | null,
  tableName: string,
  row: Record<string, unknown>,
  columnMeta: Array<{ name: string; data_type: string }>,
  engine: DatabaseEngine,
): string {
  const qi = (n: string) => quoteIdentifier(n, engine);
  const tableRef = schemaName ? `${qi(schemaName)}.${qi(tableName)}` : qi(tableName);

  const entries = Object.entries(row).filter(([, v]) => v !== undefined);
  const cols = entries.map(([c]) => qi(c)).join(', ');
  const vals = entries
    .map(([c, v]) => {
      const meta = columnMeta.find((m) => m.name === c);
      const strVal = v === null || v === undefined ? null : String(v);
      return quoteValue(strVal, meta?.data_type ?? '', engine);
    })
    .join(', ');

  return `INSERT INTO ${tableRef} (${cols}) VALUES (${vals})`;
}

function buildEditorGlow(state: string, color: string): { boxShadow: string; borderColor: string } {
  switch (state) {
    case 'running':
      return {
        boxShadow: `inset 3px 0 20px ${hexToRgba(color, 0.20)}, inset 0 0 50px ${hexToRgba(color, 0.07)}`,
        borderColor: hexToRgba(color, 0.75),
      };
    case 'success':
      return {
        boxShadow: 'inset 3px 0 20px rgba(61,220,151,0.25), inset 0 0 50px rgba(61,220,151,0.09)',
        borderColor: 'rgba(61,220,151,0.70)',
      };
    case 'error':
      return {
        boxShadow: 'inset 3px 0 20px rgba(255,90,95,0.25), inset 0 0 50px rgba(255,90,95,0.09)',
        borderColor: 'rgba(255,90,95,0.70)',
      };
    case 'warning':
      return {
        boxShadow: 'inset 3px 0 18px rgba(255,181,71,0.20), inset 0 0 45px rgba(255,181,71,0.07)',
        borderColor: 'rgba(255,181,71,0.60)',
      };
    default:
      return {
        boxShadow: `inset 3px 0 14px ${hexToRgba(color, 0.11)}`,
        borderColor: hexToRgba(color, 0.34),
      };
  }
}
