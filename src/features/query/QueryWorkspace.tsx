import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { useQueriesStore } from '../../store/queries';
import { type DatabaseEngine, useConnectionsStore } from '../../store/connections';
import { invoke } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { ensureColumnsCached, ensureTablesCached } from '../database/metadata-cache';
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
}

interface QueryExecutionResult extends QueryResult {
  statement: string;
  title: string;
}

interface ExecuteQueryPayload {
  result: QueryResult;
  history_item_id: string;
}

const SEMANTIC_SUCCESS_DURATION_MS = 3600;
const SEMANTIC_ERROR_DURATION_MS = 6200;
const SEMANTIC_WARNING_DURATION_MS = 6200;

export default function QueryWorkspace({
  connectionLabel,
  engine,
  schemaLabel,
}: {
  connectionLabel?: string;
  engine?: DatabaseEngine;
  schemaLabel?: string;
}) {
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
    clearPendingExecution,
  } = useQueriesStore();
  const { activeConnectionId, connections, setActiveConnection } = useConnectionsStore();
  const runtimeStatus = useConnectionRuntimeStore((state) =>
    activeConnectionId ? state.runtimeStatus[activeConnectionId] : undefined,
  );
  const appendLog = useConnectionRuntimeStore((state) => state.appendLog);
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const locale = useUiPreferencesStore((state) => state.locale);
  const semanticBackgroundState = useUiPreferencesStore((state) => state.semanticBackgroundState);
  const semanticBackgroundVersion = useUiPreferencesStore((state) => state.semanticBackgroundVersion);
  const setSemanticBackgroundState = useUiPreferencesStore((state) => state.setSemanticBackgroundState);
  const resultPageSize = useUiPreferencesStore((state) => state.resultPageSize);
  const setResultPageSize = useUiPreferencesStore((state) => state.setResultPageSize);
  const editorFontSize = useUiPreferencesStore((state) => state.editorFontSize);
  const density = useUiPreferencesStore((state) => state.density);
  const metadataByConnection = useDatabaseSessionStore((state) => state.metadataByConnection);
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params);
  
  const activeTab = tabs.find(t => t.id === activeTabId);
  const isConnectionReady = runtimeStatus === 'connected';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<QueryErrorPresentation | null>(null);
  const [results, setResults] = useState<QueryExecutionResult[]>([]);
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState('');
  const [resultsHeight, setResultsHeight] = useState(34);
  const [resultsResizing, setResultsResizing] = useState(false);
  const [pendingRiskyExecution, setPendingRiskyExecution] = useState<string[] | null>(null);
  const [pageSizeDraft, setPageSizeDraft] = useState(String(resultPageSize));
  const executeQueryRef = useRef<() => void>(() => {});
  const editorRef = useRef<any>(null);
  const lastCursorPositionRef = useRef<{ lineNumber: number; column: number } | null>(null);
  const autocompleteDisposableRef = useRef<{ dispose(): void } | null>(null);
  const suggestTimeoutRef = useRef<number | null>(null);
  const semanticResetTimeoutRef = useRef<number | null>(null);
  const autocompleteContextRef = useRef<{
    connectionId?: string | null;
    activeSchema?: string | null;
    engine?: DatabaseEngine | null;
  }>({
    connectionId: activeConnectionId,
    activeSchema: schemaLabel,
    engine,
  });

  useEffect(() => {
    autocompleteContextRef.current = {
      connectionId: activeConnectionId,
      activeSchema: schemaLabel,
      engine,
    };
  }, [activeConnectionId, engine, schemaLabel]);

  useEffect(() => {
    if (!activeConnectionId || !engine || !schemaLabel) {
      return;
    }

    void ensureTablesCached(activeConnectionId, engine, schemaLabel).catch(() => null);
  }, [activeConnectionId, engine, schemaLabel]);

  useEffect(() => () => {
    autocompleteDisposableRef.current?.dispose();
    if (suggestTimeoutRef.current) {
      window.clearTimeout(suggestTimeoutRef.current);
    }
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
    }
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

  const runQueryBatch = useCallback(async (queries: string[], connectionId: string) => {
    const statements = queries.map((item) => item.trim()).filter(Boolean);
    if (!statements.length || !connectionId) {
      return;
    }
    
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
      semanticResetTimeoutRef.current = null;
    }

    setSemanticBackgroundState('running');
    setLoading(true);
    setError(null);
    setResults([]);
    setActiveResultIndex(0);

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

        nextResults.push({
          ...payload.result,
          statement,
          title: `Result ${index + 1}`,
        });

        appendLog(
          connectionId,
          `Query executada com sucesso (${payload.result.execution_time}ms): ${summarizeStatementForLog(statement)}`,
        );
      }

      setResults(nextResults);
      setActiveResultIndex(0);
      setSemanticBackgroundState('success');
      scheduleSemanticReset(SEMANTIC_SUCCESS_DURATION_MS);
    } catch (e: any) {
      const nextError = buildQueryErrorPresentation({
        error: e,
        engine,
        statement: statements[0] ?? null,
        activeSchema: schemaLabel,
        metadataConnection: metadataByConnection[connectionId],
      });
      setError(nextError);
      appendLog(connectionId, `Erro de query: ${extractErrorMessage(e).trim()}`);
      setSemanticBackgroundState('error');
      scheduleSemanticReset(SEMANTIC_ERROR_DURATION_MS);
    } finally {
      setLoading(false);
    }
  }, [appendLog, engine, metadataByConnection, resultPageSize, scheduleSemanticReset, schemaLabel, setSemanticBackgroundState]);

  const executeStatements = useCallback(async (statements: string[]) => {
    if (!activeConnectionId) {
      return;
    }

    await runQueryBatch(statements, activeConnectionId);
  }, [activeConnectionId, runQueryBatch]);

  const executeQuery = useCallback(async (options?: { skipRiskConfirmation?: boolean }) => {
    if (!activeTab || !activeConnectionId) return;

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
  }, [activeTab, activeConnectionId, executeStatements, scheduleSemanticReset, setSemanticBackgroundState]);

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
      replaceActiveTabContent(item.queryText, deriveHistoryTabTitle(item.queryText));
    } else {
      addTabWithContent(item.queryText, deriveHistoryTabTitle(item.queryText));
    }

    try {
      await invoke('open_connection', { config: connection });
      setActiveConnection(connection.id);
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
  }, [addTabWithContent, connections, replaceActiveTabContent, runQueryBatch, schemaLabel, setActiveConnection]);

  const openHistoryInNewTab = useCallback((item: QueryHistoryItem) => {
    addTabWithContent(item.queryText, deriveHistoryTabTitle(item.queryText));
  }, [addTabWithContent]);

  const replaceCurrentWithHistory = useCallback((item: QueryHistoryItem) => {
    replaceActiveTabContent(item.queryText, deriveHistoryTabTitle(item.queryText));
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
    if (!targetResult || !activeConnectionId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await invoke<ExecuteQueryPayload>('execute_query', {
        connId: activeConnectionId,
        query: targetResult.statement,
        page: nextPage,
        pageSize: targetResult.page_size ?? resultPageSize,
      });

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
          metadataConnection: activeConnectionId ? metadataByConnection[activeConnectionId] : undefined,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId, engine, metadataByConnection, resultPageSize, results, schemaLabel]);

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

    if (loading || !activeTab || !activeConnectionId || !isConnectionReady) {
      return;
    }

    clearPendingExecution();
    void executeQuery();
  }, [
    activeConnectionId,
    activeTab,
    activeTabId,
    clearPendingExecution,
    executeQuery,
    isConnectionReady,
    loading,
    pendingExecutionTabId,
  ]);

  useEffect(() => () => {
    if (semanticResetTimeoutRef.current) {
      window.clearTimeout(semanticResetTimeoutRef.current);
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
  const cachedSourceColumns = activeConnectionId && activeSourceTable?.schemaName && activeSourceTable.tableName
    ? metadataByConnection[activeConnectionId]?.schemasByName[activeSourceTable.schemaName]?.tablesByName[activeSourceTable.tableName]?.columns
    : undefined;
  const totalRows = activeResult?.total_rows ?? activeResult?.rows.length ?? 0;
  const currentPage = activeResult?.page ?? 1;
  const pageSize = activeResult?.page_size ?? resultPageSize;
  const totalPages = Math.max(1, Math.ceil(totalRows / Math.max(pageSize, 1)));
  const canPaginate = hasGridResult && activeResult?.page != null && activeResult?.page_size != null;
  const rowNumberOffset = canPaginate ? (currentPage - 1) * pageSize : 0;
  const gridColumns = useMemo(
    () => buildGridColumns(activeResult, cachedSourceColumns),
    [activeResult, cachedSourceColumns],
  );

  useEffect(() => {
    if (!activeConnectionId || !engine || !activeSourceTable?.schemaName || !activeSourceTable.tableName) {
      return;
    }

    if (cachedSourceColumns?.length) {
      return;
    }

    void ensureColumnsCached(activeConnectionId, engine, activeSourceTable.schemaName, activeSourceTable.tableName).catch(() => null);
  }, [activeConnectionId, activeSourceTable, cachedSourceColumns, engine]);

  const applyPageSize = useCallback(async () => {
    const parsed = Number(pageSizeDraft);
    const normalized = Math.min(1000, Math.max(1, Number.isFinite(parsed) ? Math.round(parsed) : resultPageSize));
    setPageSizeDraft(String(normalized));
    setResultPageSize(normalized);

    if (!activeResult || !activeConnectionId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = await invoke<ExecuteQueryPayload>('execute_query', {
        connId: activeConnectionId,
        query: activeResult.statement,
        page: 1,
        pageSize: normalized,
      });

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
          metadataConnection: activeConnectionId ? metadataByConnection[activeConnectionId] : undefined,
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId, activeResult, activeResultIndex, engine, metadataByConnection, pageSizeDraft, resultPageSize, schemaLabel, setResultPageSize]);

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
          <div className="shrink-0 overflow-hidden rounded-lg border border-border/80 glass-panel shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
            <div className="flex items-center overflow-x-auto scrollbar-hide border-b border-border/70 bg-background/16">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`group flex items-center gap-2 px-3 py-3 border-r border-border/70 min-w-[148px] max-w-[240px] cursor-pointer select-none rounded-t-lg border-b-2 transition-colors ${
                    activeTabId === tab.id
                      ? 'bg-background/80 text-primary border-b-primary'
                      : 'text-muted border-b-transparent hover:bg-border/20'
                  }`}
                >
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
              ))}
              <button
                onClick={addTab}
                className="ml-auto mr-2 inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-background/28 px-3 py-2 text-xs text-muted hover:bg-border/30 hover:text-text"
              >
                <Plus size={15} />
                {t('newQueryTab')}
              </button>
            </div>

            <div className="px-3 py-2.5 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void executeQuery()}
                disabled={loading || !activeTab || !activeConnectionId || !isConnectionReady}
                className="flex items-center gap-1.5 bg-emerald-400/18 text-emerald-200 hover:bg-emerald-400/26 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-400/35 shadow-[0_0_18px_rgba(16,185,129,0.18)] hover:shadow-[0_0_24px_rgba(16,185,129,0.28)]"
              >
                {loading ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} className="fill-green-400/50" />}
                {t('run')}
              </button>
              <span className="rounded-full border border-border/70 bg-background/22 px-2.5 py-1 text-[11px] text-muted">
                Cmd+Enter
              </span>
              <button
                onClick={toggleHistory}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  historyOpen
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted hover:bg-border/30 hover:text-text'
                }`}
              >
                <Clock3 size={13} />
                {t('history')}
              </button>
              {connectionLabel && engine ? (
                <div className="ml-auto flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/22 px-3 py-1.5">
                  <span className="truncate text-[11px] uppercase tracking-[0.14em] text-muted">
                    {schemaLabel ? `${engine.toUpperCase()} • ${connectionLabel} • ${schemaLabel}` : `${engine.toUpperCase()} • ${connectionLabel}`}
                  </span>
                  {!isConnectionReady ? (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-amber-200">
                      {t('disconnected')}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex-1 relative min-h-0 flex flex-col overflow-hidden rounded-lg border border-border/80 glass-panel shadow-[0_18px_48px_rgba(0,0,0,0.24)]">
            {activeTab ? (
              <div className="flex-1 min-h-[220px] overflow-hidden rounded-lg bg-background/30">
                <Editor
                  height="100%"
                  language="sql"
                  theme="blacktable-night"
                  value={activeTab.content}
                  onChange={(val) => updateTabContent(activeTab.id, val || "")}
                  beforeMount={(monaco) => {
                    monaco.editor.defineTheme('blacktable-night', {
                      base: 'vs-dark',
                      inherit: true,
                      rules: [
                        { token: 'keyword', foreground: '62D7FF' },
                        { token: 'number', foreground: '8BE9FD' },
                        { token: 'string', foreground: '9FE870' },
                        { token: 'comment', foreground: '60708E' },
                      ],
                      colors: {
                        'editor.background': '#08111D',
                        'editor.lineHighlightBackground': '#0F1C2D',
                        'editorCursor.foreground': '#62D7FF',
                        'editorLineNumber.foreground': '#4A607D',
                        'editorLineNumber.activeForeground': '#9FC2E8',
                        'editor.selectionBackground': '#163A59',
                        'editor.inactiveSelectionBackground': '#10273D',
                        'editorIndentGuide.background1': '#132236',
                        'editorIndentGuide.activeBackground1': '#21405F',
                        'editorSuggestWidget.background': '#091321',
                        'editorSuggestWidget.border': '#1B3248',
                        'editorSuggestWidget.foreground': '#D5E5F8',
                        'editorSuggestWidget.highlightForeground': '#62D7FF',
                        'editorSuggestWidget.selectedBackground': '#14304B',
                        'editorSuggestWidget.selectedForeground': '#FFFFFF',
                        'editorSuggestWidget.selectedIconForeground': '#62D7FF',
                        'editorSuggestWidgetStatus.foreground': '#7E98B8',
                      },
                    });
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
                          editor.trigger('blacktable', 'editor.action.triggerSuggest', {});
                        }, 90);
                      }
                    });
                    editor.onDidChangeCursorPosition((event) => {
                      lastCursorPositionRef.current = event.position;
                    });
                    editor.addAction({
                      id: 'blacktable.runQuery',
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
                  <button onClick={addTab} className="px-4 py-2 glass-panel border border-border rounded-lg text-sm hover:text-text flex items-center gap-2 mx-auto">
                    <Plus size={16} /> {t('newQuery')}
                  </button>
                </div>
              </div>
            )}
          </div>

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

          <div
            className="min-h-[190px] max-h-[58%] rounded-lg border border-border/80 glass-panel flex flex-col shrink-0 flex-grow-0 relative max-[720px]:h-[40%] overflow-hidden shadow-[0_18px_48px_rgba(0,0,0,0.24)]"
            style={{ height: `${resultsHeight}%` }}
          >
            <div className="p-2 border-b border-border text-sm font-medium text-muted flex justify-between items-center bg-background/42">
              <div className="flex gap-2 px-2 shrink-0 overflow-x-auto scrollbar-hide">
                {(results.length ? results : [{ title: t('result') } as QueryExecutionResult]).map((item, index) => (
                  <div
                    key={`${item.title}-${index}`}
                    className={`rounded-t-lg border-b-2 px-2.5 pb-1 pt-0.5 text-xs transition-colors ${
                      activeResultIndex === index
                        ? 'text-text border-primary'
                        : 'text-muted border-transparent hover:text-text hover:border-border/70'
                    }`}
                  >
                    <button
                      onClick={() => setActiveResultIndex(index)}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span>{results.length <= 1 ? t('result') : item.title}</span>
                    </button>
                    {results.length > 1 ? (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          closeResultTab(index);
                        }}
                        className="ml-1 inline-flex items-center text-muted transition-colors hover:text-text"
                        aria-label={`Fechar ${item.title}`}
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {activeResult ? (
                <div className="flex items-center gap-2 px-2 min-w-0">
                  <div className="hidden md:flex items-center gap-2 text-xs text-muted shrink-0">
                    {hasGridResult ? (
                      <span>
                        {formatNumber(locale, filteredRows.length)}
                        {quickFilter ? ` / ${formatNumber(locale, activeResult.rows.length)}` : ''} {t('rowsLabel')}
                      </span>
                    ) : null}
                    {hasGridResult ? <span>{t('totalRecords', { count: formatNumber(locale, totalRows) })}</span> : null}
                    {canPaginate ? <span>{t('pageOf', { page: currentPage, total: totalPages })}</span> : null}
                    <span>{activeResult.execution_time}ms</span>
                  </div>
                  {hasGridResult ? (
                    <>
                      {canPaginate ? (
                        <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/24 px-1.5 py-1">
                          <label className="inline-flex items-center gap-1 rounded-md px-1 text-[11px] text-muted">
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              value={pageSizeDraft}
                              onChange={(event) => setPageSizeDraft(event.target.value)}
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
                          value={quickFilter}
                          onChange={(event) => setQuickFilter(event.target.value)}
                          placeholder={t('quickFilter')}
                          className="w-full bg-transparent text-xs text-text outline-none placeholder:text-muted"
                        />
                      </label>
                      <button
                        onClick={() => exportRowsAsCsv(activeResult.columns, filteredRows, buildExportBaseName(connectionLabel))}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
                      >
                        <Download size={13} />
                        CSV
                      </button>
                      <button
                        onClick={() => exportRowsAsJson(filteredRows, buildExportBaseName(connectionLabel))}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
                      >
                        <FileJson size={13} />
                        JSON
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex-1 overflow-auto bg-background/10">
              {loading ? (
                <div className="h-full flex items-center justify-center text-muted">
                  <div className="flex items-center gap-3">
                    <LoaderCircle size={16} className="animate-spin text-primary" />
                    <span className="text-[10px] uppercase tracking-[0.14em] text-primary/70">
                      {t('loadingResults')}
                    </span>
                  </div>
                </div>
              ) : error ? (
                <QueryErrorPanel error={error} activeSchema={schemaLabel} />
              ) : activeResult ? (
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
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted/50 text-sm">
                        {t('executionWithoutResultSet')}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted/50 text-sm">
                  {t('runQueryToSeeResults')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <QueryHistoryDrawer
        open={historyOpen}
        locale={locale}
        connections={connections}
        onClose={() => setHistoryOpen(false)}
        onOpenInNewTab={openHistoryInNewTab}
        onReplaceCurrent={replaceCurrentWithHistory}
        onRunAgain={(item) => void runHistoryItem(item, true)}
      />

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
}: {
  error: QueryErrorPresentation;
  activeSchema?: string;
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

