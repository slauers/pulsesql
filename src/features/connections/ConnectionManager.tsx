import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  ChevronsLeft,
  ChevronsRight,
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  Plug,
  PlugZap,
  RefreshCw,
  Server,
  XCircle,
  Dot,
} from 'lucide-react';
import oracleMark from '../../assets/oracle-mark.svg';
import postgresMark from '../../assets/postgres-mark.svg';
import { ConnectionConfig, useConnectionsStore } from '../../store/connections';
import { useConnectionRuntimeStore, type RuntimeConnectionState } from '../../store/connectionRuntime';
import { useDatabaseSessionStore } from '../../store/databaseSession';
import { invalidateMetadataCache } from '../database/metadata-cache';
import { DatabaseExplorer } from '../database/Explorer';
import QueryWorkspace from '../query/QueryWorkspace';
import ConnectionForm from './ConnectionForm';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';

const RECONNECT_DELAYS_MS = [800, 1600, 3200];
const SIDEBAR_UI_STORAGE_KEY = 'connection-sidebar-ui';

export default function ConnectionManager() {
  const { connections, activeConnectionId, removeConnection, setActiveConnection } =
    useConnectionsStore();
  const activeSchema = useDatabaseSessionStore(
    (state) => (activeConnectionId ? state.activeSchemaByConnection[activeConnectionId] ?? null : null),
  );
  const metadataActivity = useDatabaseSessionStore(
    (state) => (activeConnectionId ? state.metadataActivityByConnection[activeConnectionId] : undefined),
  );
  const activeSchemaMetadata = useDatabaseSessionStore((state) =>
    activeConnectionId && activeSchema
      ? state.metadataByConnection[activeConnectionId]?.schemasByName[activeSchema]
      : undefined,
  );
  const runtimeStatus = useConnectionRuntimeStore((state) => state.runtimeStatus);
  const connectionLogs = useConnectionRuntimeStore((state) => state.connectionLogs);
  const logsExpandedByConnection = useConnectionRuntimeStore((state) => state.logsExpandedByConnection);
  const appendLog = useConnectionRuntimeStore((state) => state.appendLog);
  const setConnectionState = useConnectionRuntimeStore((state) => state.setRuntimeStatus);
  const setLogsExpanded = useConnectionRuntimeStore((state) => state.setLogsExpanded);
  const removeConnectionRuntime = useConnectionRuntimeStore((state) => state.removeConnectionRuntime);
  const [showForm, setShowForm] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarUiState().width);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarUiState().collapsed);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [explorerRefreshTokenByConnection, setExplorerRefreshTokenByConnection] = useState<Record<string, number>>({});

  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ?? null;
  const editingConnection =
    connections.find((connection) => connection.id === editingConnectionId) ?? null;
  const selectedConnection =
    connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const selectedConnectionState = selectedConnection ? resolveRuntimeConnectionState(runtimeStatus, selectedConnection.id) : 'disconnected';
  const statusBarConnection = activeConnection ?? selectedConnection ?? null;
  const statusBarState = statusBarConnection ? resolveRuntimeConnectionState(runtimeStatus, statusBarConnection.id) : 'disconnected';
  const statusBarText =
    activeSchema && !activeSchemaMetadata?.tablesLoadedAt && !activeSchemaMetadata?.tablesError
      ? `Loading tables • ${activeSchema}`
      : metadataActivity?.phase === 'loadingTables'
        ? `Loading tables • ${metadataActivity.schemaName ?? 'schema'}`
        : metadataActivity?.phase === 'loadingSchemas'
          ? 'Loading schemas'
          : metadataActivity?.phase === 'loadingColumns'
            ? `Loading columns • ${metadataActivity.schemaName ?? ''}${metadataActivity.tableName ? `.${metadataActivity.tableName}` : ''}`
            : activeConnectionId
              ? 'Ready'
              : 'Sem conexao ativa';

  useEffect(() => {
    if (activeConnectionId && !activeConnection) {
      setActiveConnection(null);
    }
  }, [activeConnection, activeConnectionId, setActiveConnection]);

  useEffect(() => {
    if (!selectedConnectionId && activeConnectionId) {
      setSelectedConnectionId(activeConnectionId);
    }
  }, [activeConnectionId, selectedConnectionId]);

  const resolveConnectionState = (connId: string): RuntimeConnectionState => {
    return resolveRuntimeConnectionState(runtimeStatus, connId);
  };

  const copyLogs = async (connId: string) => {
    const entries = connectionLogs[connId] ?? [];
    if (!entries.length) {
      return;
    }

    await navigator.clipboard.writeText(entries.join('\n'));
    appendLog(connId, 'Logs copiados para a area de transferencia.');
  };

  const testConnection = async (conn: ConnectionConfig) => {
    setSelectedConnectionId(conn.id);
    setTestStatus((current) => ({ ...current, [conn.id]: 'testing' }));
    appendLog(
      conn.id,
      `Iniciando teste de conexao para ${conn.engine.toUpperCase()} com timeout de ${conn.connectTimeoutSeconds ?? 10}s.`,
    );

    try {
      const result = await invoke<string>('test_connection', { config: conn });
      setTestStatus((current) => ({ ...current, [conn.id]: 'success' }));
      appendLog(conn.id, result);
    } catch (error) {
      setTestStatus((current) => ({ ...current, [conn.id]: 'error' }));
      appendLog(conn.id, formatConnectionError(error));
    }
  };

  const openConnection = async (conn: ConnectionConfig, forceReconnect = false) => {
    setSelectedConnectionId(conn.id);

    const currentState = resolveConnectionState(conn.id);
    if (forceReconnect && currentState === 'connected') {
      appendLog(conn.id, 'A conexao ja esta ativa.');
      return;
    }

    const maxAttempts = conn.autoReconnect ? RECONNECT_DELAYS_MS.length + 1 : 1;
    appendLog(
      conn.id,
      forceReconnect
        ? `Reconectando ${conn.name}.`
        : `Abrindo conexao ${conn.name} com timeout de ${conn.connectTimeoutSeconds ?? 10}s.`,
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const isRetry = attempt > 1;
      setConnectionState(conn.id, isRetry ? 'reconnecting' : 'connecting');

      try {
        await invoke('open_connection', { config: conn });
        setConnectionState(conn.id, 'connected');
        invalidateMetadataCache(conn.id);
        setActiveConnection(conn.id);
        appendLog(
          conn.id,
          isRetry
            ? `Conexao restabelecida na tentativa ${attempt}.`
            : 'Conexao aberta com sucesso.',
        );
        return;
      } catch (error) {
        const message = formatConnectionError(error);

        if (attempt < maxAttempts) {
          const delayMs = RECONNECT_DELAYS_MS[attempt - 1];
          setConnectionState(conn.id, 'reconnecting');
          appendLog(
            conn.id,
            `${message} Nova tentativa em ${(delayMs / 1000).toFixed(1)}s.`,
          );
          await wait(delayMs);
          continue;
        }

        setConnectionState(conn.id, 'failed');
        appendLog(conn.id, message);

        if (activeConnectionId === conn.id) {
          setActiveConnection(null);
        }
      }
    }
  };

  const toggleSelectedConnection = (connId: string) => {
    setSelectedConnectionId((current) => (current === connId ? null : connId));
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      writeSidebarUiState({ collapsed: next, width: sidebarWidth });
      return next;
    });
  };

  const handleSidebarWidthChange = (nextWidth: number) => {
    setSidebarWidth(nextWidth);
    writeSidebarUiState({ collapsed: sidebarCollapsed, width: nextWidth });
  };

  const requestExplorerRefresh = (connId: string) => {
    setExplorerRefreshTokenByConnection((current) => ({
      ...current,
      [connId]: (current[connId] ?? 0) + 1,
    }));
  };

  const handleRemoveConnection = (connId: string) => {
    removeConnection(connId);
    removeConnectionRuntime(connId);
    invalidateMetadataCache(connId);
    setTestStatus((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setSelectedConnectionId((current) => (current === connId ? null : current));
  };

  const confirmRemoveConnection = (conn: ConnectionConfig) => {
    const confirmed = window.confirm(
      `Remover a conexao "${conn.name}"?\n\nEssa acao exclui a configuracao salva desta conexao.`,
    );

    if (!confirmed) {
      return;
    }

    handleRemoveConnection(conn.id);
  };

  const disconnectConnection = async (conn: ConnectionConfig) => {
    appendLog(conn.id, `Fechando conexao ${conn.name}.`);

    try {
      await invoke('close_connection', { id: conn.id });
      setConnectionState(conn.id, 'disconnected');
      invalidateMetadataCache(conn.id);
      if (activeConnectionId === conn.id) {
        setActiveConnection(null);
      }
      appendLog(conn.id, 'Conexao fechada.');
    } catch (error) {
      appendLog(conn.id, formatConnectionError(error));
    }
  };

  useEffect(() => {
    if (!sidebarResizing || sidebarCollapsed) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = Math.min(Math.max(event.clientX, 220), 520);
      handleSidebarWidthChange(nextWidth);
    };

    const handlePointerUp = () => {
      setSidebarResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [sidebarCollapsed, sidebarResizing, sidebarWidth]);

  return (
    <div className="flex h-full w-full flex-col gap-3">
      <div className="flex min-h-0 flex-1 w-full gap-3 max-[900px]:flex-col">
        <div
          className="shrink-0 rounded-lg border border-border/80 bg-surface/58 backdrop-blur-xl flex flex-col overflow-hidden shadow-[0_20px_56px_rgba(0,0,0,0.24)] max-[900px]:w-full max-[900px]:max-h-[42vh]"
          style={{ width: `${sidebarCollapsed ? 78 : sidebarWidth}px` }}
        >
          <div className="p-4 border-b border-border/70 flex justify-between items-center sticky top-0 bg-surface/72 backdrop-blur-xl">
            {sidebarCollapsed ? (
              <div className="flex w-full flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  className="rounded-lg border border-border/70 p-2 text-muted hover:bg-border/30 hover:text-text"
                  title="Expandir sidebar"
                >
                  <ChevronsRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingConnectionId(null);
                    setShowForm(true);
                  }}
                  className="rounded-lg border border-border/70 p-2 text-muted hover:bg-border/30 hover:text-text"
                  title="Nova conexao"
                >
                  <Plus size={16} />
                </button>
              </div>
            ) : (
              <>
                <h2 className="font-semibold text-text/90 flex items-center gap-2">
                  <Server size={18} /> Connections
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingConnectionId(null);
                      setShowForm(true);
                    }}
                    className="rounded-lg border border-border/70 p-2 text-muted hover:bg-border/30 hover:text-text"
                    title="Nova conexao"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={toggleSidebarCollapsed}
                    className="rounded-lg border border-border/70 p-2 text-muted hover:bg-border/30 hover:text-text"
                    title="Ocultar sidebar"
                  >
                    <ChevronsLeft size={16} />
                  </button>
                </div>
              </>
            )}
          </div>

          {sidebarCollapsed ? (
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
              {connections.map((conn) => {
                const isSelected = selectedConnectionId === conn.id || activeConnectionId === conn.id;
                const state = resolveConnectionState(conn.id);
                return (
                  <button
                    key={conn.id}
                    type="button"
                    onClick={() => {
                      setSelectedConnectionId(conn.id);
                      setSidebarCollapsed(false);
                      writeSidebarUiState({ collapsed: false, width: sidebarWidth });
                    }}
                    title={`${conn.name} • ${state}`}
                    className={`relative flex w-full items-center justify-center rounded-lg border px-0 py-3 text-xs transition-colors ${
                      isSelected
                        ? 'border-primary/60 bg-primary/10 text-primary'
                        : 'border-border/70 bg-background/28 text-muted hover:bg-border/20 hover:text-text'
                    }`}
                  >
                    {collapsedConnectionMark(conn.engine) ? (
                      <img
                        src={collapsedConnectionMark(conn.engine) as string}
                        alt={conn.engine}
                        className="h-8 w-8 object-contain"
                      />
                    ) : (
                      <span className="max-w-[42px] truncate font-semibold">
                        {connectionShortLabel(conn.name)}
                      </span>
                    )}
                    <span className={`absolute right-2 top-2 h-2.5 w-2.5 rounded-full ${connectionStateDot(state)}`} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              <div className="space-y-2">
                {connections.length === 0 ? (
                  <p className="rounded-lg border border-border/70 bg-background/20 px-3 py-4 text-center text-sm text-muted">
                    No connections saved.
                  </p>
                ) : (
                  connections.map((conn) => {
                    const status = testStatus[conn.id] || 'idle';
                    const isActive = activeConnectionId === conn.id;
                    const isSelected = selectedConnectionId === conn.id || isActive;
                    const connectionState = resolveConnectionState(conn.id);

                    return (
                      <button
                        key={conn.id}
                        type="button"
                        onClick={() => toggleSelectedConnection(conn.id)}
                        className={`group w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                          isSelected
                            ? 'border-primary/60 bg-background/58 shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_0_16px_rgba(34,199,255,0.08)]'
                            : 'border-border/50 bg-background/18 hover:bg-background/28'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              {collapsedConnectionMark(conn.engine) ? (
                                <img
                                  src={collapsedConnectionMark(conn.engine) as string}
                                  alt={conn.engine}
                                  className="h-4 w-4 shrink-0 object-contain"
                                />
                              ) : null}
                              <div className="truncate text-sm font-medium text-text">{conn.name}</div>
                            </div>
                            <div className="mt-1 truncate text-[11px] text-muted">
                              {conn.engine.toUpperCase()} • {conn.user}@{conn.host}
                              {conn.database ? `/${conn.database}` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {status === 'testing' ? (
                              <LoaderCircle size={13} className="animate-spin text-primary" />
                            ) : status === 'success' ? (
                              <CheckCircle size={13} className="text-emerald-400" />
                            ) : status === 'error' ? (
                              <XCircle size={13} className="text-red-400" />
                            ) : null}
                            <ConnectionBadge state={connectionState} compact />
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {selectedConnection ? (
                <div className="space-y-3 rounded-lg border border-border/70 bg-background/18 p-3">
                  <div className="rounded-lg border border-border/60 bg-background/30 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {collapsedConnectionMark(selectedConnection.engine) ? (
                            <img
                              src={collapsedConnectionMark(selectedConnection.engine) as string}
                              alt={selectedConnection.engine}
                              className="h-4 w-4 shrink-0 object-contain"
                            />
                          ) : null}
                          <div className="truncate text-sm font-semibold text-text">{selectedConnection.name}</div>
                        </div>
                        <div className="mt-1 truncate text-[11px] text-muted">
                          {selectedConnection.engine.toUpperCase()} • {selectedConnection.user}@{selectedConnection.host}:{selectedConnection.port}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-muted/80">
                          {selectedConnection.database}
                          {activeSchema ? ` • ${activeSchema}` : ''}
                        </div>
                      </div>
                      <ConnectionBadge state={selectedConnectionState} />
                    </div>
                  </div>

                  <ActionSection
                    title="Acoes principais"
                    actions={buildPrimaryActions({
                      connectionState: selectedConnectionState,
                      testState: testStatus[selectedConnection.id] || 'idle',
                      onOpen: () => void openConnection(selectedConnection),
                      onDisconnect: () => void disconnectConnection(selectedConnection),
                      onTest: () => void testConnection(selectedConnection),
                    })}
                  />

                  <ActionSection
                    title="Acoes secundarias"
                    actions={buildSecondaryActions({
                      conn: selectedConnection,
                      logsExpanded: logsExpandedByConnection[selectedConnection.id] ?? true,
                      canRefreshExplorer: activeConnectionId === selectedConnection.id && selectedConnectionState === 'connected',
                      onEdit: () => {
                        setEditingConnectionId(selectedConnection.id);
                        setShowForm(true);
                      },
                      onToggleLogs: () =>
                        setLogsExpanded(selectedConnection.id, !(logsExpandedByConnection[selectedConnection.id] ?? true)),
                      onRefreshExplorer: () => requestExplorerRefresh(selectedConnection.id),
                    })}
                  />

                  <ActionSection
                    title="Remocao"
                    actions={[
                      {
                        id: 'remove',
                        label: 'Remove',
                        icon: XCircle,
                        tone: 'danger',
                        onClick: () => confirmRemoveConnection(selectedConnection),
                      },
                    ]}
                  />

                  {(logsExpandedByConnection[selectedConnection.id] ?? true) ? (
                    <div className="rounded-lg border border-border/60 bg-surface/60 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted">
                        <div className="flex items-center gap-2">
                          <FileText size={12} />
                          Connection Logs
                        </div>
                        <button
                          onClick={() => void copyLogs(selectedConnection.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:text-text hover:bg-border/30"
                        >
                          <Copy size={11} />
                          Copiar
                        </button>
                      </div>
                      {connectionLogs[selectedConnection.id]?.length ? (
                        <div className="max-h-36 overflow-auto space-y-1 font-mono text-[11px]">
                          {connectionLogs[selectedConnection.id].map((entry, index) => (
                            <ConnectionLogEntry
                              key={`${selectedConnection.id}-log-${index}`}
                              entry={entry}
                              highlighted={index === 0}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-muted/70">Nenhum log para esta conexao ainda.</div>
                      )}
                    </div>
                  ) : null}

                  {activeConnectionId === selectedConnection.id ? (
                    <DatabaseExplorer
                      connId={selectedConnection.id}
                      dbName={selectedConnection.database}
                      engine={selectedConnection.engine}
                      showRefreshButton={false}
                      refreshToken={explorerRefreshTokenByConnection[selectedConnection.id] ?? 0}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {!sidebarCollapsed ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize connections panel"
            onPointerDown={() => setSidebarResizing(true)}
            className="relative -mx-1 w-2 shrink-0 cursor-col-resize bg-transparent max-[900px]:hidden"
          />
        ) : null}

        <div className="flex-1 rounded-lg border border-border/80 glass-panel shadow-[0_20px_56px_rgba(0,0,0,0.24)] bg-transparent flex flex-col min-w-0 min-h-0 overflow-hidden">
          {showForm ? (
            <ConnectionForm
              initialConnection={editingConnection}
              onClose={() => {
                setShowForm(false);
                setEditingConnectionId(null);
              }}
            />
          ) : activeConnectionId ? (
            <QueryWorkspace
              key={activeConnectionId}
              connectionLabel={activeConnection?.name}
              engine={activeConnection?.engine}
              schemaLabel={activeSchema ?? undefined}
            />
          ) : selectedConnection ? (
            <div className="h-full flex items-center justify-center text-muted">
              <div className="rounded-lg border border-border/70 bg-background/22 px-6 py-5 text-center">
                <p className="text-sm text-text">Conexao selecionada, mas ainda desconectada.</p>
                <p className="mt-1 text-xs text-muted">Abra a conexao pela sidebar para liberar editor, explorer e execucao.</p>
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted">
              <p>Select a connection or add a new one.</p>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 rounded-lg border border-border/80 glass-panel px-4 py-1 text-[10px] shadow-[0_18px_42px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-text/90">
            {statusBarText}
          </div>
          {statusBarConnection ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="max-w-[220px] truncate text-[10px] uppercase tracking-[0.14em] text-slate-200/90">
                {statusBarConnection.name}
              </span>
              <ConnectionBadge state={statusBarState} compact glowing />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ActionItem = {
  id: string;
  label: string;
  icon: typeof Plug;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'default' | 'primary' | 'danger';
};

function ActionSection({ title, actions }: { title: string; actions: ActionItem[] }) {
  if (!actions.length) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border/60 bg-background/24 p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{title}</div>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          const tone =
            action.tone === 'primary'
              ? 'border-primary/40 bg-primary/12 text-primary hover:bg-primary/20'
              : action.tone === 'danger'
                ? 'border-red-400/25 bg-red-400/8 text-red-300 hover:bg-red-400/14'
                : 'border-border/70 bg-background/30 text-text hover:bg-border/30';

          return (
            <button
              key={action.id}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors disabled:opacity-50 ${tone}`}
            >
              {action.loading ? <LoaderCircle size={13} className="animate-spin" /> : <Icon size={13} />}
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function buildPrimaryActions({
  connectionState,
  testState,
  onOpen,
  onDisconnect,
  onTest,
}: {
  connectionState: RuntimeConnectionState;
  testState: TestStatus;
  onOpen: () => void;
  onDisconnect: () => void;
  onTest: () => void;
}): ActionItem[] {
  const isBusy = connectionState === 'connecting' || connectionState === 'reconnecting';
  const actions: ActionItem[] = [];

  if (connectionState === 'connected') {
    actions.push({
      id: 'disconnect',
      label: 'Disconnect',
      icon: PlugZap,
      onClick: onDisconnect,
      tone: 'primary',
    });
  } else {
    actions.push({
      id: 'open',
      label: connectionState === 'reconnecting' ? 'Reconectando' : 'Open',
      icon: Plug,
      onClick: onOpen,
      disabled: isBusy,
      loading: isBusy,
      tone: 'primary',
    });
  }

  actions.push({
    id: 'test',
    label: testState === 'testing' ? 'Testing' : 'Test',
    icon: CheckCircle,
    onClick: onTest,
    disabled: isBusy,
    loading: testState === 'testing',
  });

  return actions;
}

function buildSecondaryActions({
  conn,
  logsExpanded,
  canRefreshExplorer,
  onEdit,
  onToggleLogs,
  onRefreshExplorer,
}: {
  conn: ConnectionConfig;
  logsExpanded: boolean;
  canRefreshExplorer: boolean;
  onEdit: () => void;
  onToggleLogs: () => void;
  onRefreshExplorer: () => void;
}): ActionItem[] {
  const actions: ActionItem[] = [
    {
      id: `edit-${conn.id}`,
      label: 'Edit',
      icon: Pencil,
      onClick: onEdit,
    },
    {
      id: `logs-${conn.id}`,
      label: logsExpanded ? 'Ocultar logs' : 'Mostrar logs',
      icon: logsExpanded ? EyeOff : Eye,
      onClick: onToggleLogs,
    },
  ];

  if (canRefreshExplorer) {
    actions.push({
      id: `refresh-${conn.id}`,
      label: 'Refresh explorer',
      icon: RefreshCw,
      onClick: onRefreshExplorer,
    });
  }

  return actions;
}

function resolveRuntimeConnectionState(
  runtimeStatus: Record<string, RuntimeConnectionState>,
  connId: string,
): RuntimeConnectionState {
  return runtimeStatus[connId] ?? 'disconnected';
}

function connectionShortLabel(name: string): string {
  const compact = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return compact || name.slice(0, 2).toUpperCase();
}

function collapsedConnectionMark(engine: ConnectionConfig['engine']) {
  if (engine === 'oracle') {
    return oracleMark;
  }

  if (engine === 'postgres') {
    return postgresMark;
  }

  return null;
}

function connectionStateDot(state: RuntimeConnectionState): string {
  if (state === 'connected') {
    return 'bg-emerald-400';
  }

  if (state === 'connecting' || state === 'reconnecting') {
    return 'bg-sky-400';
  }

  if (state === 'failed') {
    return 'bg-red-400';
  }

  return 'bg-muted';
}

function readSidebarUiState() {
  try {
    const raw = localStorage.getItem(SIDEBAR_UI_STORAGE_KEY);
    if (!raw) {
      return { collapsed: false, width: 290 };
    }

    const parsed = JSON.parse(raw) as { collapsed?: boolean; width?: number };
    return {
      collapsed: Boolean(parsed.collapsed),
      width:
        typeof parsed.width === 'number' && Number.isFinite(parsed.width)
          ? Math.min(Math.max(parsed.width, 220), 520)
          : 290,
    };
  } catch {
    return { collapsed: false, width: 290 };
  }
}

function writeSidebarUiState(value: { collapsed: boolean; width: number }) {
  try {
    localStorage.setItem(SIDEBAR_UI_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Persistencia de UI nao deve quebrar o layout.
  }
}

function ConnectionBadge({
  state,
  compact = false,
  glowing = false,
}: {
  state: RuntimeConnectionState;
  compact?: boolean;
  glowing?: boolean;
}) {
  const palette: Record<RuntimeConnectionState, string> = {
    disconnected: 'border-red-400/20 bg-red-400/8 text-red-300',
    connecting: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
    connected: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    reconnecting: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
    failed: 'border-red-400/30 bg-red-400/10 text-red-300',
  };

  const labels: Record<RuntimeConnectionState, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    failed: 'Failed',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border ${compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5'} text-[10px] uppercase tracking-[0.14em] ${palette[state]} ${
        glowing ? 'shadow-[0_0_16px_rgba(255,255,255,0.08)]' : ''
      }`}
    >
      <Dot size={14} className="-ml-1 -mr-0.5" />
      {labels[state]}
    </span>
  );
}

function ConnectionLogEntry({
  entry,
  highlighted = false,
}: {
  entry: string;
  highlighted?: boolean;
}) {
  const match = entry.match(/^(\[[^\]]+\])\s*(.*)$/);
  const timestamp = match?.[1];
  const message = match?.[2] ?? entry;
  const tone = resolveLogTone(message);

  return (
    <div
      className={`rounded px-2 py-1.5 whitespace-pre-wrap break-words ${
        highlighted ? 'bg-background/50 ring-1 ring-border/60' : 'bg-background/25'
      }`}
    >
      {timestamp ? <span className="text-[10px] text-muted/55 mr-2">{timestamp}</span> : null}
      <span className={tone}>{message}</span>
    </div>
  );
}

function resolveLogTone(message: string): string {
  const lower = message.toLowerCase();

  if (
    lower.includes('sucesso') ||
    lower.includes('restabelecida') ||
    lower.includes('connection successful') ||
    lower.includes('logs copiados')
  ) {
    return 'text-emerald-300';
  }

  if (
    lower.includes('erro') ||
    lower.includes('falha') ||
    lower.includes('reset') ||
    lower.includes('refused') ||
    lower.includes('timed out')
  ) {
    return 'text-red-300';
  }

  if (lower.includes('tentativa') || lower.includes('reconectando')) {
    return 'text-amber-300';
  }

  return 'text-muted';
}

function formatConnectionError(error: unknown): string {
  const raw = extractErrorMessage(error);
  const normalized = raw.trim();
  const lower = normalized.toLowerCase();

  if (lower.includes('timed out')) {
    return 'Tempo limite excedido ao abrir a conexao.';
  }

  if (lower.includes('connection reset')) {
    return 'A conexao foi encerrada pelo servidor durante o handshake.';
  }

  if (lower.includes('connection refused')) {
    return 'O host recusou a conexao. Verifique host, porta e tunnel.';
  }

  if (lower.includes('authentication failed') || lower.includes('access denied')) {
    return 'Falha de autenticacao. Revise usuario, senha ou chave privada.';
  }

  if (lower.includes('connection not found')) {
    return 'A conexao nao esta disponivel no runtime. Abra ou reconecte antes de continuar.';
  }

  if (
    lower.includes('unable to locate a java runtime') ||
    lower.includes('java/jdk') ||
    lower.includes('failed to compile oracle jdbc sidecar') ||
    lower.includes('failed to run javac for oracle sidecar')
  ) {
    return 'Conexao Oracle requer Java/JDK instalado na maquina. Instale um JDK e tente novamente.';
  }

  return normalized;
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    if ('toString' in error && typeof error.toString === 'function') {
      const asString = error.toString();
      if (asString && asString !== '[object Object]') {
        return asString;
      }
    }

    if ('message' in error && typeof error.message === 'string') {
      return error.message;
    }

    if ('error' in error && typeof error.error === 'string') {
      return error.error;
    }

    if ('cause' in error && typeof error.cause === 'string') {
      return error.cause;
    }

    return JSON.stringify(error);
  }

  return 'Erro desconhecido ao executar a operacao.';
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
