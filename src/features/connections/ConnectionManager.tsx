import { useState } from 'react';
import { useConnectionsStore, ConnectionConfig } from '../../store/connections';
import { invoke } from '@tauri-apps/api/core';
import { Server, Plus, LoaderCircle, CheckCircle, XCircle, Pencil, Plug, FileText, Copy } from 'lucide-react';
import ConnectionForm from './ConnectionForm';
import { SchemaTree } from '../database/Explorer';
import QueryWorkspace from '../query/QueryWorkspace';

export default function ConnectionManager() {
  const { connections, activeConnectionId, removeConnection, setActiveConnection } = useConnectionsStore();
  const [showForm, setShowForm] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, 'idle' | 'testing' | 'success' | 'error'>>({});
  const [connectionLogs, setConnectionLogs] = useState<Record<string, string[]>>({});
  const activeConnection = connections.find((connection) => connection.id === activeConnectionId) ?? null;
  const editingConnection = connections.find((connection) => connection.id === editingConnectionId) ?? null;
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? null;

  const copyLogs = async (connId: string) => {
    const entries = connectionLogs[connId] ?? [];
    if (!entries.length) {
      return;
    }

    await navigator.clipboard.writeText(entries.join('\n'));
    appendLog(connId, 'Logs copiados para a area de transferencia.');
  };

  const appendLog = (connId: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    setConnectionLogs((current) => ({
      ...current,
      [connId]: [`[${timestamp}] ${message}`, ...(current[connId] ?? [])].slice(0, 30),
    }));
  };

  const testConnection = async (conn: ConnectionConfig) => {
    setSelectedConnectionId(conn.id);
    setTestStatus(prev => ({ ...prev, [conn.id]: 'testing' }));
    appendLog(conn.id, `Iniciando teste de conexao para ${conn.engine.toUpperCase()}.`);
    try {
      const result = await invoke<string>('test_connection', { config: conn });
      setTestStatus(prev => ({ ...prev, [conn.id]: 'success' }));
      appendLog(conn.id, result);
    } catch (e) {
      console.error(e);
      setTestStatus(prev => ({ ...prev, [conn.id]: 'error' }));
      appendLog(conn.id, extractErrorMessage(e));
    }
  };

  const openConnection = async (conn: ConnectionConfig) => {
    setSelectedConnectionId(conn.id);
    appendLog(conn.id, `Abrindo conexao ${conn.name}.`);
    try {
      await invoke('open_connection', { config: conn });
      setActiveConnection(conn.id);
      appendLog(conn.id, 'Conexao aberta com sucesso.');
    } catch (e) {
      console.error("Failed to open connection", e);
      appendLog(conn.id, extractErrorMessage(e));
    }
  };

  return (
    <div className="flex h-full w-full max-[900px]:flex-col">
      <div className="w-[290px] shrink-0 border-r border-border/80 glass-panel flex flex-col max-[900px]:w-full max-[900px]:max-h-[42vh] max-[900px]:border-r-0 max-[900px]:border-b">
        <div className="p-4 border-b border-border/80 flex justify-between items-center sticky top-0 glass-panel">
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
            connections.map(conn => {
              const status = testStatus[conn.id] || 'idle';
              const isActive = activeConnectionId === conn.id;
                  return (
                <div 
                  key={conn.id} 
                  className={`p-3 rounded border text-sm group cursor-pointer transition-colors mb-2 ${
                    selectedConnectionId === conn.id || isActive
                      ? 'border-primary/70 bg-background/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_0_24px_rgba(34,199,255,0.08)]'
                      : 'border-border/60 hover:bg-border/20 bg-transparent'
                  }`}
                  onClick={() => setSelectedConnectionId(conn.id)}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-medium truncate">{conn.name}</span>
                    <div className="flex items-center gap-1">
                      {status === 'testing' && <LoaderCircle size={14} className="animate-spin text-blue-400" />}
                      {status === 'success' && <CheckCircle size={14} className="text-green-500" />}
                      {status === 'error' && <XCircle size={14} className="text-red-500" />}
                    </div>
                  </div>
                  <div className="text-xs text-muted truncate">
                    {conn.engine.toUpperCase()} | {conn.user}@{conn.host}:{conn.port} | {conn.database}
                  </div>
                  <div className="mt-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity pb-1 border-b border-transparent group-hover:border-border/50">
                    <button 
                      onClick={(e) => { e.stopPropagation(); openConnection(conn); }}
                      className="text-xs text-emerald-400 hover:underline"
                    >
                      Open
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setSelectedConnectionId(conn.id); testConnection(conn); }}
                      className="text-xs text-blue-400 hover:underline"
                    >
                      Test
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeConnection(conn.id); }}
                      className="text-xs text-red-400 hover:underline"
                    >
                      Remove
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingConnectionId(conn.id);
                        setShowForm(true);
                      }}
                      className="text-xs text-amber-400 hover:underline"
                    >
                      Edit
                    </button>
                  </div>

                  {selectedConnectionId === conn.id && (
                    <div className="mt-2 pt-2 border-t border-border/50" onClick={e => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-2 px-2 pb-2">
                        <button
                          onClick={() => testConnection(conn)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text hover:bg-border/40"
                        >
                          <CheckCircle size={12} />
                          Test
                        </button>
                        <button
                          onClick={() => openConnection(conn)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-text hover:bg-border/40"
                        >
                          <Plug size={12} />
                          Open
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
                      </div>

                      <div className="rounded border border-border/50 bg-surface/60 p-2 mx-2 mb-2">
                        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-muted">
                          <div className="flex items-center gap-2">
                            <FileText size={12} />
                            Connection Logs
                          </div>
                          <button
                            onClick={() => copyLogs(conn.id)}
                            className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted hover:text-text hover:bg-border/30"
                          >
                            <Copy size={11} />
                            Copiar
                          </button>
                        </div>
                        {connectionLogs[conn.id]?.length ? (
                          <div className="max-h-36 overflow-auto space-y-1 font-mono text-[11px] text-muted">
                            {connectionLogs[conn.id].map((entry, index) => (
                              <div key={`${conn.id}-log-${index}`} className="whitespace-pre-wrap break-words">
                                {entry}
                              </div>
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

      <div className="flex-1 bg-transparent flex flex-col min-w-0 min-h-0">
        {showForm ? (
          <ConnectionForm
            initialConnection={editingConnection}
            onClose={() => {
              setShowForm(false);
              setEditingConnectionId(null);
            }}
          />
        ) : (
          activeConnectionId ? (
            <QueryWorkspace key={activeConnectionId} connectionLabel={activeConnection?.name} engine={activeConnection?.engine} />
          ) : selectedConnection ? (
            <div className="h-full p-4 md:p-8 overflow-auto">
              <div className="max-w-3xl space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-text">{selectedConnection.name}</h2>
                  <p className="text-sm text-muted mt-1">
                    {selectedConnection.engine.toUpperCase()} | {selectedConnection.user}@{selectedConnection.host}:{selectedConnection.port} | {selectedConnection.database}
                  </p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => testConnection(selectedConnection)}
                    className="px-4 py-2 rounded text-sm border border-border text-text hover:bg-border/40"
                  >
                    Testar conexao
                  </button>
                  <button
                    onClick={() => openConnection(selectedConnection)}
                    className="px-4 py-2 rounded text-sm bg-primary text-white hover:bg-blue-600"
                  >
                    Abrir conexao
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
                      onClick={() => copyLogs(selectedConnection.id)}
                      className="inline-flex items-center gap-2 rounded border border-border px-3 py-1.5 text-xs text-muted hover:text-text hover:bg-border/30"
                    >
                      <Copy size={12} />
                      Copiar logs
                    </button>
                  </div>
                  {connectionLogs[selectedConnection.id]?.length ? (
                    <div className="space-y-2 font-mono text-xs text-muted">
                      {connectionLogs[selectedConnection.id].map((entry, index) => (
                        <div key={`${selectedConnection.id}-panel-log-${index}`} className="whitespace-pre-wrap break-words">
                          {entry}
                        </div>
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
          )
        )}
      </div>
    </div>
  );
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
