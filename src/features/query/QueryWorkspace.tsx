import { useState, useCallback, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { useQueriesStore } from '../../store/queries';
import { useConnectionsStore } from '../../store/connections';
import { invoke } from '@tauri-apps/api/core';
import { Plus, X, Play, LoaderCircle, AlertCircle } from 'lucide-react';
import ResultGrid from './ResultGrid';

interface QueryResult {
  columns: string[];
  rows: any[];
  execution_time: number;
}

export default function QueryWorkspace({ connectionLabel, engine }: { connectionLabel?: string; engine?: string }) {
  const { tabs, activeTabId, addTab, setActiveTab, closeTab, updateTabContent } = useQueriesStore();
  const { activeConnectionId } = useConnectionsStore();
  
  const activeTab = tabs.find(t => t.id === activeTabId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const executeQueryRef = useRef<() => void>(() => {});

  const executeQuery = useCallback(async () => {
    if (!activeTab || !activeTab.content.trim() || !activeConnectionId) return;
    
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await invoke<QueryResult>('execute_query', { 
        connId: activeConnectionId, 
        query: activeTab.content 
      });
      setResult(res);
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setLoading(false);
    }
  }, [activeTab, activeConnectionId]);

  useEffect(() => {
    executeQueryRef.current = () => {
      void executeQuery();
    };
  }, [executeQuery]);

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden relative min-h-0">
      <div className="flex items-center glass-panel border-b border-border overflow-x-auto shrink-0 scrollbar-hide">
        {tabs.map(tab => (
          <div 
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center gap-2 px-3 py-3 border-r border-border/70 w-32 max-w-[220px] cursor-pointer select-none border-b-2 transition-colors
              ${activeTabId === tab.id ? 'bg-background/80 text-primary border-b-primary' : 'text-muted border-b-transparent hover:bg-border/20'}
            `}
          >
            <span className="text-sm truncate flex-1">{tab.title}</span>
            <button 
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className="p-1 rounded hover:bg-border/50 text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
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
          disabled={loading || !activeTab}
          className="flex items-center gap-1.5 bg-emerald-500/12 text-emerald-300 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-emerald-500/20"
        >
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} className="fill-green-400/50" />} 
          Run
        </button>
        <div className="mx-2 h-4 w-px bg-border/50"></div>
        <span className="text-xs text-muted">Press Cmd+Enter to execute</span>
        {connectionLabel && engine && (
          <>
            <div className="mx-2 h-4 w-px bg-border/50"></div>
            <span className="text-xs text-muted uppercase tracking-wide">
              {engine} · {connectionLabel}
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
              }}
              onMount={(editor, monaco) => {
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

      <div className="h-[34%] min-h-[190px] max-h-[58%] border-t border-border glass-panel flex flex-col shrink-0 flex-grow-0 relative max-[720px]:h-[40%]">
        <div className="p-2 border-b border-border text-sm font-medium text-muted flex justify-between items-center bg-background/30">
          <div className="flex gap-4 px-2">
            <button className="text-text border-b-2 border-primary pb-1">Result Grid</button>
          </div>
          {result && (
            <span className="text-xs text-muted mr-2">
              {result.rows.length} rows in {result.execution_time}ms
            </span>
          )}
        </div>
        
        <div className="flex-1 overflow-auto bg-background/10">
          {error ? (
            <div className="p-4 flex items-start gap-3 text-red-400">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm font-mono whitespace-pre-wrap">{error}</div>
            </div>
          ) : result ? (
            <ResultGrid columns={result.columns} rows={result.rows} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted/50 text-sm">
              Run a query to see results
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
