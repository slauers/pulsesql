import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CheckCircle,
  Copy,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  Plug,
  PlugZap,
  RotateCcw,
  Server,
  XCircle,
  Dot,
} from 'lucide-react';
import { ConnectionConfig, useConnectionsStore } from '../../store/connections';
import { SchemaTree } from '../database/Explorer';
import QueryWorkspace from '../query/QueryWorkspace';
import ConnectionForm from './ConnectionForm';

type TestStatus = 'idle' | 'testing' | 'success' | 'error';
type RuntimeConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

const RECONNECT_DELAYS_MS = [800, 1600, 3200];

export default function ConnectionManager() {
  const { connections, activeConnectionId, removeConnection, setActiveConnection } =
    useConnectionsStore();
  const [showForm, setShowForm] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({});
  const [runtimeStatus, setRuntimeStatus] = useState<Record<string, RuntimeConnectionState>>({});
  const [connectionLogs, setConnectionLogs] = useState<Record<string, string[]>>({});
  const [sidebarWidth, setSidebarWidth] = useState(290);
  const [sidebarResizing, setSidebarResizing] = useState(false);

  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ?? null;
  const editingConnection =
    connections.find((connection) => connection.id === editingConnectionId) ?? null;
  const selectedConnection =
    connections.find((connection) => connection.id === selectedConnectionId) ?? null;

  const appendLog = (connId: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    setConnectionLogs((current) => ({
      ...current,
      [connId]: [`[${timestamp}] ${message}`, ...(current[connId] ?? [])].slice(0, 40),
    }));
  };

  const setConnectionState = (connId: string, state: RuntimeConnectionState) => {
    setRuntimeStatus((current) => ({ ...current, [connId]: state }));
  };

  const resolveConnectionState = (connId: string, isActive: boolean): RuntimeConnectionState => {
    const state = runtimeStatus[connId];
    if (state) {
      return state;
    }

    return isActive ? 'connected' : 'disconnected';
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

    const currentState = resolveConnectionState(conn.id, activeConnectionId === conn.id);
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

  const handleRemoveConnection = (connId: string) => {
    removeConnection(connId);
    setRuntimeStatus((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
    setConnectionLogs((current) => {
      const next = { ...current };
      delete next[connId];
      return next;
    });
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
      if (activeConnectionId === conn.id) {
        setActiveConnection(null);
      }
      appendLog(conn.id, 'Conexao fechada.');
    } catch (error) {
      appendLog(conn.id, formatConnectionError(error));
    }
  };

  useEffect(() => {
    if (!sidebarResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = Math.min(Math.max(event.clientX, 220), 520);
      setSidebarWidth(nextWidth);
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
  }, [sidebarResizing]);

  return (
    <div className="flex h-full w-full max-[900px]:flex-col">
      <div
        className="shrink-0 border-r border-border/70 bg-surface/58 backdrop-blur-xl flex flex-col max-[900px]:w-full max-[900px]:max-h-[42vh] max-[900px]:border-r-0 max-[900px]:border-b"
        style={{ width: `${sidebarWidth}px` }}
      >
        <div className="p-4 border-b border-border/70 flex justify-between items-center sticky top-0 bg-surface/72 backdrop-blur-xl">
          <h2 className="font-semibold text-text/90 flex items-center gap-2">
            <Server size={18} /> Connections
          </h2>
          <button
            onClick={() => {
              setEditingConnectionId(null);
              setShowForm(true);
            }}
            className="p-1 hover:bg-border rounded text-muted hover:text-text"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
          {connections.length === 0 ? (
            <p className="text-center text-sm text-muted mt-4">No connections saved.</p>
          ) : (
            connections.map((conn) => {
              const status = testStatus[conn.id] || 'idle';
              const isActive = activeConnectionId === conn.id;
              const connectionState = resolveConnectionState(conn.id, isActive);
              const isBusy =
                connectionState === 'connecting' || connectionState === 'reconnecting';

              return (
                <div
                  key={conn.id}
                  className={`p-3 rounded-xl border text-sm group cursor-pointer transition-colors mb-2 ${
                    selectedConnectionId === conn.id || isActive
                      ? 'border-primary/60 bg-background/58 shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_0_16px_rgba(34,199,255,0.08)]'
                      : 'border-transparent hover:border-border/50 hover:bg-background/22 bg-transparent'
                  }`}
                  onClick={() => toggleSelectedConnection(conn.id)}
                >
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <div className="min-w-0">
                      <div className="font-medium truncate text-text">{conn.name}</div>
                      <div className="text-xs text-muted truncate mt-1">
                        {conn.engine.toUpperCase()} | {conn.user}@{conn.host}
                        {conn.database ? `/${conn.database}` : ''}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 self-start">
                      {status === 'testing' ? (
                        <LoaderCircle size={14} className="animate-spin text-primary" />
                      ) : status === 'success' ? (
                        <CheckCircle size={14} className="text-emerald-400" />
                      ) : status === 'error' ? (
                        <XCircle size={14} className="text-red-400" />
                      ) : null}
                      <ConnectionBadge state={connectionState} compact />
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void openConnection(conn);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg  px-2.5 py-1.5 text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                      disabled={isBusy}
                    >
                      <Plug size={12} />
                      Open
                    </button>
                    <div className="flex items-center gap-1 text-[11px] text-muted">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void testConnection(conn);
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-border/30 hover:text-text disabled:opacity-50"
                        disabled={isBusy}
                        title="Test connection"
                      >
                        <CheckCircle size={12} />
                        Test
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingConnectionId(conn.id);
                          setShowForm(true);
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-border/30 hover:text-text"
                        title="Edit connection"
                      >
                        <Pencil size={12} />
                        Edit
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          confirmRemoveConnection(conn);
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-red-300 hover:bg-red-400/10"
                        title="Remove connection"
                      >
                        <XCircle size={12} />
                        Remove
                      </button>
                    </div>
                  </div>

                  {selectedConnectionId === conn.id && (
                    <div className="mt-2 pt-2 border-t border-border/50" onClick={(event) => event.stopPropagation()}>
                      <div className="flex flex-wrap gap-2 px-2 pb-2">
                        <button
                          onClick={() => void openConnection(conn, true)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text hover:bg-border/40 disabled:opacity-50"
                          disabled={isBusy || connectionState === 'connected'}
                        >
                          {connectionState === 'reconnecting' ? (
                            <LoaderCircle size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          {connectionState === 'reconnecting' ? 'Reconnecting...' : 'Reconnect'}
                        </button>
                        <button
                          onClick={() => void disconnectConnection(conn)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text hover:bg-border/40 disabled:opacity-50"
                          disabled={isBusy || connectionState === 'disconnected'}
                        >
                          <PlugZap size={12} />
                          Disconnect
                        </button>
                        <button
                          onClick={() => {
                            setEditingConnectionId(conn.id);
                            setShowForm(true);
                          }}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text hover:bg-border/40"
                        >
                          <Pencil size={12} />
                          Edit
                        </button>
                        <button
                          onClick={() => confirmRemoveConnection(conn)}
                          className="inline-flex items-center gap-1 rounded border border-red-400/20 px-2 py-1 text-xs text-red-300 hover:bg-red-400/10"
                        >
                          <XCircle size={12} />
                          Remove
                        </button>
                      </div>

                      <div className="px-2 pb-2 text-[11px] text-muted/80">
                        Reconnect: {conn.autoReconnect ? 'auto' : 'manual'} ({conn.connectTimeoutSeconds ?? 10}s)
                        {' · '}
                        <span className={conn.autoReconnect ? 'text-emerald-400' : 'text-amber-300'}>
                          {conn.autoReconnect ? 'ativo' : 'desligado'}
                        </span>
                      </div>

                      <div className="rounded border border-border/50 bg-surface/60 p-2 mx-2 mb-2">
                        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted">
                          <div className="flex items-center gap-2">
                            <FileText size={12} />
                            Connection Logs
                          </div>
                          <button
                            onClick={() => void copyLogs(conn.id)}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-text hover:bg-border/30"
                          >
                            <Copy size={11} />
                            Copiar
                          </button>
                        </div>
                        {connectionLogs[conn.id]?.length ? (
                          <div className="max-h-36 overflow-auto space-y-1 font-mono text-[11px]">
                            {connectionLogs[conn.id].map((entry, index) => (
                              <ConnectionLogEntry
                                key={`${conn.id}-log-${index}`}
                                entry={entry}
                                highlighted={index === 0}
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted/70">Nenhum log para esta conexao ainda.</div>
                        )}
                      </div>

                      {isActive && conn.engine === 'postgres' ? (
                        <SchemaTree connId={conn.id} />
                      ) : isActive ? (
                        <p className="text-xs text-muted px-2 py-1">
                          Metadata explorer fica limitado ao query runner para {conn.engine.toUpperCase()} nesta fase.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize connections panel"
        onPointerDown={() => setSidebarResizing(true)}
        className={`relative w-1 shrink-0 cursor-col-resize bg-transparent transition-colors max-[900px]:hidden ${
          sidebarResizing ? 'bg-primary/40' : 'hover:bg-primary/25'
        }`}
      >
        <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-border/70" />
      </div>

      <div className="flex-1 bg-transparent flex flex-col min-w-0 min-h-0">
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
          />
        ) : selectedConnection ? (
          <div className="h-full p-4 md:p-8 overflow-auto">
            <div className="max-w-3xl space-y-6">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-bold text-text">{selectedConnection.name}</h2>
                  <ConnectionBadge
                    state={resolveConnectionState(
                      selectedConnection.id,
                      activeConnectionId === selectedConnection.id,
                    )}
                  />
                </div>
                <p className="text-sm text-muted mt-1">
                  {selectedConnection.engine.toUpperCase()} | {selectedConnection.user}@
                  {selectedConnection.host}:{selectedConnection.port} | {selectedConnection.database}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => void testConnection(selectedConnection)}
                  className="px-4 py-2 rounded text-sm border border-border text-text hover:bg-border/40"
                >
                  Testar conexao
                </button>
                <button
                  onClick={() => void openConnection(selectedConnection)}
                  className="px-4 py-2 rounded text-sm bg-primary text-white hover:bg-blue-600"
                >
                  Abrir conexao
                </button>
                <button
                  onClick={() => void openConnection(selectedConnection, true)}
                  className="px-4 py-2 rounded text-sm border border-border text-text hover:bg-border/40 disabled:opacity-50"
                  disabled={
                    resolveConnectionState(
                      selectedConnection.id,
                      activeConnectionId === selectedConnection.id,
                    ) === 'connected'
                  }
                >
                  Reconnect
                </button>
                <button
                  onClick={() => void disconnectConnection(selectedConnection)}
                  className="px-4 py-2 rounded text-sm border border-border text-text hover:bg-border/40 disabled:opacity-50"
                  disabled={
                    resolveConnectionState(
                      selectedConnection.id,
                      activeConnectionId === selectedConnection.id,
                    ) === 'disconnected'
                  }
                >
                  Disconnect
                </button>
                <button
                  onClick={() => {
                    setEditingConnectionId(selectedConnection.id);
                    setShowForm(true);
                  }}
                  className="px-4 py-2 rounded text-sm border border-border text-text hover:bg-border/40"
                >
                  Editar conexao
                </button>
              </div>

              <div className="rounded-2xl border border-border glass-panel p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-text">Logs da conexao</div>
                  <button
                    onClick={() => void copyLogs(selectedConnection.id)}
                    className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-text hover:bg-border/30"
                  >
                    <Copy size={12} />
                    Copiar logs
                  </button>
                </div>
                {connectionLogs[selectedConnection.id]?.length ? (
                  <div className="space-y-2 font-mono text-xs">
                    {connectionLogs[selectedConnection.id].map((entry, index) => (
                      <ConnectionLogEntry
                        key={`${selectedConnection.id}-panel-log-${index}`}
                        entry={entry}
                        highlighted={index === 0}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Ainda nao ha logs para esta conexao.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-muted">
            <p>Select a connection or add a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConnectionBadge({
  state,
  compact = false,
}: {
  state: RuntimeConnectionState;
  compact?: boolean;
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
      className={`inline-flex items-center rounded-full border ${compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5'} text-[10px] uppercase tracking-[0.14em] ${palette[state]}`}
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
