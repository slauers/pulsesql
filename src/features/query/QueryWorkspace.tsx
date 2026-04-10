import { useState, useCallback, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { useQueriesStore } from '../../store/queries';
import { type DatabaseEngine, useConnectionsStore } from '../../store/connections';
import { invoke } from '@tauri-apps/api/core';
import { ensureTablesCached } from '../database/metadata-cache';
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
} from 'lucide-react';
import ResultGrid from './ResultGrid';
import QueryHistoryDrawer from '../history/components/QueryHistoryDrawer';
import type { QueryHistoryItem } from '../history/types';
import { isTableSuggestionContext, registerSqlAutocomplete } from './sql-autocomplete';
import { useDatabaseSessionStore } from '../../store/databaseSession';

interface QueryResult {
  columns: string[];
  rows: any[];
  execution_time: number;
}

interface ExecuteQueryPayload {
  result: QueryResult;
  history_item_id: string;
}

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
    addTab,
    addTabWithContent,
    setActiveTab,
    closeTab,
    updateTabContent,
    replaceActiveTabContent,
  } = useQueriesStore();
  const { activeConnectionId, connections, setActiveConnection } = useConnectionsStore();
  const metadataActivity = useDatabaseSessionStore((state) =>
    activeConnectionId ? state.metadataActivityByConnection[activeConnectionId] : undefined,
  );
  const activeSchemaMetadata = useDatabaseSessionStore((state) =>
    activeConnectionId && schemaLabel
      ? state.metadataByConnection[activeConnectionId]?.schemasByName[schemaLabel]
      : undefined,
  );
  
  const activeTab = tabs.find(t => t.id === activeTabId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [quickFilter, setQuickFilter] = useState('');
  const [resultsHeight, setResultsHeight] = useState(34);
  const [resultsResizing, setResultsResizing] = useState(false);
  const executeQueryRef = useRef<() => void>(() => {});
  const autocompleteDisposableRef = useRef<{ dispose(): void } | null>(null);
  const suggestTimeoutRef = useRef<number | null>(null);
  const autocompleteContextRef = useRef<{ connectionId?: string | null; activeSchema?: string | null }>({
    connectionId: activeConnectionId,
    activeSchema: schemaLabel,
  });

  useEffect(() => {
    autocompleteContextRef.current = {
      connectionId: activeConnectionId,
      activeSchema: schemaLabel,
    };
  }, [activeConnectionId, schemaLabel]);

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
  }, []);

  const runQuery = useCallback(async (queryText: string, connectionId: string) => {
    const trimmedQuery = queryText.trim();
    if (!trimmedQuery || !connectionId) {
      return;
    }
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload = await invoke<ExecuteQueryPayload>('execute_query', { 
        connId: connectionId, 
        query: trimmedQuery,
      });
      setResult(payload.result);
    } catch (e: any) {
      setError(formatQueryError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const executeQuery = useCallback(async () => {
    if (!activeTab || !activeConnectionId) return;
    await runQuery(activeTab.content, activeConnectionId);
  }, [activeTab, activeConnectionId, runQuery]);

  const runHistoryItem = useCallback(async (item: QueryHistoryItem, replaceCurrent: boolean) => {
    const connection = connections.find((current) => current.id === item.connectionId);

    if (!connection) {
      setError('A conexao salva para este historico nao existe mais.');
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
      await runQuery(item.queryText, connection.id);
    } catch (runError) {
      setError(formatQueryError(runError));
    }
  }, [addTabWithContent, connections, replaceActiveTabContent, runQuery, setActiveConnection]);

  const openHistoryInNewTab = useCallback((item: QueryHistoryItem) => {
    addTabWithContent(item.queryText, deriveHistoryTabTitle(item.queryText));
  }, [addTabWithContent]);

  const replaceCurrentWithHistory = useCallback((item: QueryHistoryItem) => {
    replaceActiveTabContent(item.queryText, deriveHistoryTabTitle(item.queryText));
  }, [replaceActiveTabContent]);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((current) => !current);
  }, []);

  useEffect(() => {
    executeQueryRef.current = () => {
      void executeQuery();
    };
  }, [executeQuery]);

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

  const filteredRows = result
    ? applyQuickFilter(result.rows, result.columns, quickFilter)
    : [];

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden relative min-h-0">
      <div className="flex items-center glass-panel border-b border-border overflow-x-auto shrink-0 scrollbar-hide">
        {tabs.map(tab => (
          <div 
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center gap-2 px-3 py-3 border-r border-border/70 min-w-[148px] max-w-[240px] cursor-pointer select-none border-b-2 transition-colors
              ${activeTabId === tab.id ? 'bg-background/80 text-primary border-b-primary' : 'text-muted border-b-transparent hover:bg-border/20'}
            `}
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
        <button onClick={addTab} className="px-3 py-2 text-muted hover:text-text hover:bg-border/30 shrink-0">
          <Plus size={16} />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border/80 glass-panel flex flex-wrap items-center gap-2 shrink-0">
        <button 
          onClick={executeQuery}
          disabled={loading || !activeTab || !activeConnectionId}
          className="flex items-center gap-1.5 bg-emerald-400/18 text-emerald-200 hover:bg-emerald-400/26 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-400/35 shadow-[0_0_18px_rgba(16,185,129,0.18)] hover:shadow-[0_0_24px_rgba(16,185,129,0.28)]"
        >
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} className="fill-green-400/50" />} 
          Run
        </button>
        <div className="mx-2 h-4 w-px bg-border/50"></div>
        <span className="text-xs text-muted">Cmd+Enter to run</span>
        <button
          onClick={toggleHistory}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            historyOpen
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border text-muted hover:bg-border/30 hover:text-text'
          }`}
        >
          <Clock3 size={13} />
          History
        </button>
        {connectionLabel && engine && (
          <>
            <div className="mx-2 h-4 w-px bg-border/50"></div>
            <span className="text-xs text-muted uppercase tracking-wide">
              {schemaLabel ? `${engine.toUpperCase()} • ${connectionLabel} • ${schemaLabel}` : `${engine.toUpperCase()} • ${connectionLabel}`}
            </span>
          </>
        )}
      </div>

      <div className="flex-1 relative min-h-0 flex flex-col overflow-hidden">
        {activeTab ? (
          <div className="flex-1 min-h-[220px] bg-background/30">
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
                  },
                });
              }}
              options={{
                minimap: { enabled: false },
                padding: { top: 18 },
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                scrollBeyondLastLine: false,
                roundedSelection: false,
                smoothScrolling: true,
                overviewRulerBorder: false,
                quickSuggestions: {
                  other: true,
                  comments: false,
                  strings: false,
                },
                suggestOnTriggerCharacters: true,
              }}
              onMount={(editor, monaco) => {
                autocompleteDisposableRef.current?.dispose();
                autocompleteDisposableRef.current = registerSqlAutocomplete(monaco, () => autocompleteContextRef.current);
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
                editor.addAction({
                  id: 'blacktable.runQuery',
                  label: 'Run Query',
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
              <p className="mb-2">No active queries.</p>
              <button onClick={addTab} className="px-4 py-2 glass-panel border border-border rounded-xl text-sm hover:text-text flex items-center gap-2 mx-auto">
                <Plus size={16} /> Create new query
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
        className={`h-1 shrink-0 cursor-row-resize bg-transparent transition-colors ${
          resultsResizing ? 'bg-primary/40' : 'hover:bg-primary/25'
        }`}
      >
        <div className="mx-auto h-full w-24 rounded-full bg-border/70" />
      </div>

      <div
        className="min-h-[190px] max-h-[58%] border-t border-border glass-panel flex flex-col shrink-0 flex-grow-0 relative max-[720px]:h-[40%]"
        style={{ height: `${resultsHeight}%` }}
      >
        <div className="p-2 border-b border-border text-sm font-medium text-muted flex justify-between items-center bg-background/42">
          <div className="flex gap-4 px-2 shrink-0">
            <button className="text-text border-b-2 border-primary pb-1">Result Grid</button>
          </div>
          {result ? (
            <div className="flex items-center gap-2 px-2 min-w-0">
              <div className="hidden md:flex items-center gap-2 text-xs text-muted shrink-0">
                <span>
                  {filteredRows.length}
                  {quickFilter ? ` / ${result.rows.length}` : ''} rows
                </span>
                <span>{result.execution_time}ms</span>
              </div>
              <label className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/30 px-2.5 py-1.5 min-w-[180px] md:min-w-[220px]">
                <Search size={13} className="shrink-0 text-muted" />
                <input
                  value={quickFilter}
                  onChange={(event) => setQuickFilter(event.target.value)}
                  placeholder="Filtro rapido"
                  className="w-full bg-transparent text-xs text-text outline-none placeholder:text-muted"
                />
              </label>
              <button
                onClick={() => exportRowsAsCsv(result.columns, filteredRows, buildExportBaseName(connectionLabel))}
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
            </div>
          ) : null}
        </div>
        
        <div className="flex-1 overflow-auto bg-background/10">
          {loading ? (
            <div className="h-full flex items-center justify-center text-muted">
              <div className="flex items-center gap-3">
                <LoaderCircle size={16} className="animate-spin text-primary" />
                <span className="text-[10px] uppercase tracking-[0.14em] text-primary/70">
                  Retrieving data...
                </span>
              </div>
            </div>
          ) : error ? (
            <div className="p-4 flex items-start gap-3 text-red-400">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm font-mono whitespace-pre-wrap">{error}</div>
            </div>
          ) : result ? (
            <ResultGrid columns={result.columns} rows={filteredRows} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted/50 text-sm">
              Run a query to see results
            </div>
          )}
        </div>
        <div className="border-t border-border/70 px-3 py-1.5 text-[11px] text-muted bg-background/35">
          {schemaLabel && !activeSchemaMetadata?.tablesLoadedAt && !activeSchemaMetadata?.tablesError
            ? `Loading tables • ${schemaLabel}`
            : metadataActivity?.phase === 'loadingTables'
            ? `Loading tables • ${metadataActivity.schemaName ?? 'schema'}`
            : metadataActivity?.phase === 'loadingSchemas'
              ? 'Loading schemas'
              : metadataActivity?.phase === 'loadingColumns'
                ? `Loading columns • ${metadataActivity.schemaName ?? ''}${metadataActivity.tableName ? `.${metadataActivity.tableName}` : ''}`
                : 'Ready'}
        </div>
      </div>

      <QueryHistoryDrawer
        open={historyOpen}
        connections={connections}
        onClose={() => setHistoryOpen(false)}
        onOpenInNewTab={openHistoryInNewTab}
        onReplaceCurrent={replaceCurrentWithHistory}
        onRunAgain={(item) => void runHistoryItem(item, true)}
      />
    </div>
  );
}

function deriveHistoryTabTitle(queryText: string): string {
  const firstLine = queryText
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return 'History Query';
  }

  return firstLine.slice(0, 36);
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

function formatQueryError(error: unknown): string {
  const raw = extractErrorMessage(error).trim();
  const lower = raw.toLowerCase();

  if (lower.includes('connection not found')) {
    return 'A conexao ativa nao esta disponivel. Abra ou reconecte a conexao antes de executar a query.';
  }

  if (lower.includes('timed out')) {
    return 'A query excedeu o tempo limite configurado.';
  }

  if (lower.includes('ora-00933')) {
    return 'Oracle: comando SQL nao encerrado adequadamente.';
  }

  if (lower.includes('ora-00942')) {
    return 'Oracle: tabela ou view nao existe.';
  }

  if (lower.includes('ora-01017')) {
    return 'Oracle: usuario ou senha invalidos.';
  }

  if (lower.includes('permission denied') || lower.includes('not authorized')) {
    return 'Permissao insuficiente para executar esta operacao.';
  }

  return raw;
}

function extractErrorMessage(error: unknown): string {
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
