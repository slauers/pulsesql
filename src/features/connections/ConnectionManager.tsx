import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  ChevronsRight,
  PanelLeft,
  Check,
  Copy,
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  Expand,
  FileText,
  Info,
  CheckCircle2,
  LoaderCircle,
  Plus,
  Plug,
  PlugZap,
  Star,
  Upload,
  XCircle,
  Dot,
} from 'lucide-react';
import { marked } from 'marked';
import tauriConfig from '../../../src-tauri/tauri.conf.json';
import changelog from '../../../CHANGELOG.md?raw';
import oracleMark from '../../assets/oracle-mark.svg';
import postgresMark from '../../assets/postgres-mark.svg';
import pulsesqlFooter from '../../assets/pulsesql-footer.svg';
import pulsesqlFooterCompact from '../../assets/pulsesql-footer-compact.svg';
import { ConnectionConfig, useConnectionsStore } from '../../store/connections';
import { useConnectionRuntimeStore, type RuntimeConnectionState } from '../../store/connectionRuntime';
import { useDatabaseSessionStore } from '../../store/databaseSession';
import { useUiPreferencesStore } from '../../store/uiPreferences';
import { invalidateMetadataCache } from '../database/metadata-cache';
import { DatabaseExplorer } from '../database/Explorer';
import QueryWorkspace from '../query/QueryWorkspace';
import ConnectionForm from './ConnectionForm';
import { translate } from '../../i18n';

const RECONNECT_DELAYS_MS = [800, 1600, 3200];
const CONNECTION_MENU_WIDTH = 180;

type ConnectionContextMenuState = {
  x: number;
  y: number;
  connId: string;
};

type ServerTimePayload = {
  value: string;
};

type ConnectionTransactionStatePayload = {
  autocommit_enabled: boolean;
  transaction_open: boolean;
  supported: boolean;
};

export default function ConnectionManager() {
  const { connections, activeConnectionId, favoriteConnectionId, addConnection, removeConnection, setActiveConnection, setFavoriteConnection } =
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
  const autocommitByConnection = useConnectionRuntimeStore((state) => state.autocommitByConnection);
  const transactionOpenByConnection = useConnectionRuntimeStore((state) => state.transactionOpenByConnection);
  const appendLog = useConnectionRuntimeStore((state) => state.appendLog);
  const setConnectionState = useConnectionRuntimeStore((state) => state.setRuntimeStatus);
  const setLogsExpanded = useConnectionRuntimeStore((state) => state.setLogsExpanded);
  const initializeConnectionRuntime = useConnectionRuntimeStore((state) => state.initializeConnectionRuntime);
  const setAutocommitEnabled = useConnectionRuntimeStore((state) => state.setAutocommitEnabled);
  const setTransactionOpen = useConnectionRuntimeStore((state) => state.setTransactionOpen);
  const removeConnectionRuntime = useConnectionRuntimeStore((state) => state.removeConnectionRuntime);
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const showServerTimeInStatusBar = useUiPreferencesStore((state) => state.showServerTimeInStatusBar);
  const setSemanticBackgroundEnabled = useUiPreferencesStore((state) => state.setSemanticBackgroundEnabled);
  const locale = useUiPreferencesStore((state) => state.locale);
  const showAutocommitInStatusBar = useUiPreferencesStore((state) => state.showAutocommitInStatusBar);
  const sidebarWidth = useUiPreferencesStore((state) => state.sidebarWidth);
  const setSidebarWidth = useUiPreferencesStore((state) => state.setSidebarWidth);
  const sidebarCollapsed = useUiPreferencesStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useUiPreferencesStore((state) => state.setSidebarCollapsed);
  const logsExpandedByDefault = useUiPreferencesStore((state) => state.logsExpandedByDefault);
  const [showForm, setShowForm] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [connectionContextMenu, setConnectionContextMenu] = useState<ConnectionContextMenuState | null>(null);
  const [expandedLogsConnectionId, setExpandedLogsConnectionId] = useState<string | null>(null);
  const [copiedLogsId, setCopiedLogsId] = useState<string | null>(null);
  const copiedLogsTimeoutRef = useRef<number | null>(null);
  const [serverTimeValue, setServerTimeValue] = useState<string | null>(null);
  const [compactViewport, setCompactViewport] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 980 || window.innerHeight < 700 : false,
  );
  const semanticToggleRef = useRef<HTMLButtonElement | null>(null);
  const serverTimeRequestInFlightRef = useRef(false);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportSelectedIds, setExportSelectedIds] = useState<Set<string>>(new Set());
  const [exportSavedPath, setExportSavedPath] = useState<string | null>(null);
  const [removeConfirmConn, setRemoveConfirmConn] = useState<ConnectionConfig | null>(null);

  const activeConnection =
    connections.find((connection) => connection.id === activeConnectionId) ?? null;
  const editingConnection =
    connections.find((connection) => connection.id === editingConnectionId) ?? null;
  const selectedConnection =
    connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const statusBarConnection = activeConnection ?? selectedConnection ?? null;
  const statusBarState = statusBarConnection ? resolveRuntimeConnectionState(runtimeStatus, statusBarConnection.id) : 'disconnected';
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate(locale, key, params);
  const tLog = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
    translate('en-US', key, params);
  const activeConnectionState = activeConnection ? resolveRuntimeConnectionState(runtimeStatus, activeConnection.id) : 'disconnected';
  const statusBarText =
    activeSchema && !activeSchemaMetadata?.tablesLoadedAt && !activeSchemaMetadata?.tablesError
      ? `${t('loadingTables')} • ${activeSchema}`
      : metadataActivity?.phase === 'loadingTables'
        ? `${t('loadingTables')} • ${metadataActivity.schemaName ?? 'schema'}`
        : metadataActivity?.phase === 'loadingSchemas'
          ? t('loadingSchemas')
          : metadataActivity?.phase === 'loadingColumns'
            ? `${t('loadingColumns')} • ${metadataActivity.schemaName ?? ''}${metadataActivity.tableName ? `.${metadataActivity.tableName}` : ''}`
              : activeConnectionId
                ? t('ready')
                : t('noActiveConnection');
  const serverTimeIndicator =
    showServerTimeInStatusBar && activeConnectionState === 'connected' && serverTimeValue
      ? `${t('serverTimePrefix')} ${serverTimeValue}`
      : null;
  const activeAutocommitEnabled =
    activeConnectionId ? (autocommitByConnection[activeConnectionId] ?? true) : true;
  const activeTransactionOpen =
    activeConnectionId ? transactionOpenByConnection[activeConnectionId] === true : false;
  const showAutocommitIndicator =
    showAutocommitInStatusBar &&
    activeConnection != null &&
    activeConnection.engine !== 'oracle' &&
    activeConnectionState === 'connected';
  const contextMenuConnection =
    connectionContextMenu
      ? connections.find((item) => item.id === connectionContextMenu.connId) ?? null
      : null;
  const contextMenuState = contextMenuConnection
    ? resolveRuntimeConnectionState(runtimeStatus, contextMenuConnection.id)
    : 'disconnected';
  const effectiveSidebarWidth = sidebarCollapsed ? 68 : compactViewport ? Math.min(sidebarWidth, 300) : sidebarWidth;

  useEffect(() => {
    if (activeConnectionId && !activeConnection) {
      setActiveConnection(null);
    }
  }, [activeConnection, activeConnectionId, setActiveConnection]);

  useEffect(() => {
    const handlePointerDown = () => {
      setConnectionContextMenu(null);
    };

    window.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const updateViewportMode = () => {
      setCompactViewport(window.innerWidth < 980 || window.innerHeight < 700);
    };

    updateViewportMode();
    window.addEventListener('resize', updateViewportMode);

    return () => {
      window.removeEventListener('resize', updateViewportMode);
    };
  }, []);

  useEffect(() => {
    if (!showServerTimeInStatusBar || !activeConnection || activeConnectionState !== 'connected') {
      setServerTimeValue(null);
      serverTimeRequestInFlightRef.current = false;
      return;
    }

    let cancelled = false;

    const pollServerTime = async () => {
      if (serverTimeRequestInFlightRef.current) {
        return;
      }

      serverTimeRequestInFlightRef.current = true;

      try {
        const payload = await invoke<ServerTimePayload>('get_server_time', {
          connId: activeConnection.id,
        });

        if (!cancelled) {
          setServerTimeValue(payload.value);
        }
      } catch {
        if (!cancelled) {
          setServerTimeValue(null);
        }
      } finally {
        serverTimeRequestInFlightRef.current = false;
      }
    };

    void pollServerTime();
    const intervalId = window.setInterval(() => {
      void pollServerTime();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      setServerTimeValue(null);
      serverTimeRequestInFlightRef.current = false;
    };
  }, [activeConnection, activeConnectionState, showServerTimeInStatusBar]);

  useEffect(() => {
    const handleToggleSidebar = () => {
      toggleSidebarCollapsed();
    };

    const handleNewConnection = () => {
      setEditingConnectionId(null);
      setShowForm(true);
      if (sidebarCollapsed) {
        setSidebarCollapsed(false);
      }
    };

    window.addEventListener('pulsesql:toggle-sidebar', handleToggleSidebar as EventListener);
    window.addEventListener('pulsesql:new-connection', handleNewConnection as EventListener);

    return () => {
      window.removeEventListener('pulsesql:toggle-sidebar', handleToggleSidebar as EventListener);
      window.removeEventListener('pulsesql:new-connection', handleNewConnection as EventListener);
    };
  }, [sidebarCollapsed, sidebarWidth]);

  const resolveConnectionState = (connId: string): RuntimeConnectionState => {
    return resolveRuntimeConnectionState(runtimeStatus, connId);
  };

  const copyLogs = async (connId: string) => {
    const entries = connectionLogs[connId] ?? [];
    if (!entries.length) {
      return;
    }

    await navigator.clipboard.writeText(entries.join('\n'));
    appendLog(connId, t('logsCopied'));
    if (copiedLogsTimeoutRef.current) window.clearTimeout(copiedLogsTimeoutRef.current);
    setCopiedLogsId(connId);
    copiedLogsTimeoutRef.current = window.setTimeout(() => setCopiedLogsId(null), 1500);
  };

  const openExportModal = () => {
    setExportSelectedIds(new Set(connections.map((c) => c.id)));
    setExportSavedPath(null);
    setExportModalOpen(true);
  };

  const confirmExport = async () => {
    const selected = connections.filter((c) => exportSelectedIds.has(c.id));
    if (!selected.length) return;
    const content = JSON.stringify(selected, null, 2);
    try {
      const path = await invoke<string>('save_connections_export', {
        content,
        filename: 'pulsesql-connections.json',
      });
      setExportSavedPath(path);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const importConnections = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        if (!Array.isArray(parsed)) throw new Error('Expected an array of connections.');
        let imported = 0;
        for (const raw of parsed) {
          if (!raw.name || !raw.engine || !raw.host) continue;
          addConnection({ ...raw, id: crypto.randomUUID() });
          imported++;
        }
        if (imported === 0) throw new Error('No valid connections found in file.');
      } catch (err) {
        alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
  };

  const handleAutocommitStatusBarToggle = async () => {
    if (!activeConnection || activeConnection.engine === 'oracle' || activeConnectionState !== 'connected') {
      return;
    }

    try {
      const payload = await invoke<ConnectionTransactionStatePayload>('set_connection_autocommit', {
        connId: activeConnection.id,
        enabled: !activeAutocommitEnabled,
      });
      setAutocommitEnabled(activeConnection.id, payload.autocommit_enabled);
      setTransactionOpen(activeConnection.id, payload.transaction_open);
      appendLog(
        activeConnection.id,
        payload.autocommit_enabled ? tLog('autocommitOn') : tLog('autocommitOff'),
      );
    } catch (error) {
      appendLog(
        activeConnection.id,
        typeof error === 'string' ? error : error instanceof Error ? error.message : tLog('autocommitUnsupported'),
      );
    }
  };

  const openConnection = async (conn: ConnectionConfig, forceReconnect = false) => {
    setSelectedConnectionId(conn.id);

    const currentState = resolveConnectionState(conn.id);
    if (!forceReconnect && currentState === 'connected') {
      appendLog(conn.id, tLog('connectionAlreadyActive'));
      return;
    }

    const maxAttempts = conn.autoReconnect ? RECONNECT_DELAYS_MS.length + 1 : 1;
    appendLog(
      conn.id,
      forceReconnect
        ? tLog('reconnectingConnection', { name: conn.name })
        : tLog('openingConnectionWithTimeout', { name: conn.name, seconds: conn.connectTimeoutSeconds ?? 10 }),
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const isRetry = attempt > 1;
      setConnectionState(conn.id, isRetry ? 'reconnecting' : 'connecting');

      try {
        await invoke('open_connection', { config: conn });
        setConnectionState(conn.id, 'connected');
        initializeConnectionRuntime(conn.id, true);
        setAutocommitEnabled(conn.id, true);
        setTransactionOpen(conn.id, false);
        invalidateMetadataCache(conn.id);
        setActiveConnection(conn.id);
        appendLog(
          conn.id,
          isRetry
            ? tLog('connectionRestoredOnAttempt', { attempt })
            : tLog('connectionOpenedSuccessfully'),
        );
        return;
      } catch (error) {
        const message = formatConnectionError(error, 'en-US');

        if (attempt < maxAttempts) {
          const delayMs = RECONNECT_DELAYS_MS[attempt - 1];
          setConnectionState(conn.id, 'reconnecting');
          appendLog(
            conn.id,
            `${message} Retrying in ${(delayMs / 1000).toFixed(1)}s.`,
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

  const openConnectionContextMenu = (event: ReactMouseEvent<HTMLElement>, connId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setConnectionContextMenu({
      connId,
      x: Math.min(rect.right - CONNECTION_MENU_WIDTH, window.innerWidth - CONNECTION_MENU_WIDTH - 8),
      y: Math.min(rect.bottom + 8, window.innerHeight - 120),
    });
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(!sidebarCollapsed);
  };

  const handleSidebarWidthChange = (nextWidth: number) => {
    setSidebarWidth(nextWidth);
  };

  const handleRemoveConnection = (connId: string) => {
    removeConnection(connId);
    removeConnectionRuntime(connId);
    invalidateMetadataCache(connId);
    setSelectedConnectionId((current) => (current === connId ? null : current));
  };

  const confirmRemoveConnection = (conn: ConnectionConfig) => {
    setRemoveConfirmConn(conn);
  };

  const disconnectConnection = async (conn: ConnectionConfig) => {
    appendLog(conn.id, tLog('closingConnection', { name: conn.name }));

    try {
      await invoke('close_connection', { id: conn.id });
      setConnectionState(conn.id, 'disconnected');
      setAutocommitEnabled(conn.id, true);
      setTransactionOpen(conn.id, false);
      invalidateMetadataCache(conn.id);
      if (activeConnectionId === conn.id) {
        setActiveConnection(null);
      }
      appendLog(conn.id, tLog('connectionClosed'));
    } catch (error) {
      appendLog(conn.id, formatConnectionError(error, 'en-US'));
    }
  };

  const handleSemanticBackgroundToggle = () => {
    setSemanticBackgroundEnabled(!semanticBackgroundEnabled);

    semanticToggleRef.current?.animate(
      [
        { color: 'rgba(148, 163, 184, 0.9)', textShadow: '0 0 0 rgba(110,72,255,0)' },
        { color: 'rgba(110, 72, 255, 1)', textShadow: '0 0 14px rgba(110,72,255,0.45), 0 0 28px rgba(110,72,255,0.24)' },
        { color: semanticBackgroundEnabled ? 'rgba(148, 163, 184, 0.9)' : 'rgba(110, 72, 255, 1)', textShadow: '0 0 0 rgba(110,72,255,0)' },
      ],
      { duration: 680, easing: 'ease-out' },
    );
  };

  useEffect(() => {
    if (!sidebarResizing || sidebarCollapsed) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = Math.min(Math.max(event.clientX, 300), 520);
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
    <div className="flex h-full w-full flex-col">
      <div className="flex min-h-0 flex-1 w-full">
        <div
          className="shrink-0 border-r border-border/80 bg-surface/92 flex flex-col overflow-hidden"
          style={{ width: `${effectiveSidebarWidth}px` }}
        >
          <div className="px-3 py-2 border-b border-border/80 flex justify-between items-center sticky top-0 bg-surface/95 z-10">
            {sidebarCollapsed ? (
              <div className="flex w-full flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={toggleSidebarCollapsed}
                  className="p-2 text-muted hover:bg-background/45 hover:text-text"
                  title={t('expandSidebar')}
                >
                  <ChevronsRight size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingConnectionId(null);
                    setShowForm(true);
                  }}
                  className="p-2 text-muted hover:bg-background/45 hover:text-text"
                  title={t('newConnection')}
                >
                  <Plus size={16} />
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-text flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleSidebarCollapsed}
                    className="p-0.5 rounded text-muted hover:bg-background/45 hover:text-text transition-colors"
                    title={t('hideSidebar')}
                  >
                    <PanelLeft size={14} />
                  </button>
                  Explorer
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => importFileRef.current?.click()}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-sky-300 hover:bg-sky-400/12 hover:text-sky-200 transition-colors"
                    title={t('importConnections')}
                  >
                    <Download size={12} />
                    <span>Import</span>
                  </button>
                  <button
                    type="button"
                    onClick={openExportModal}
                    className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-emerald-300 hover:bg-emerald-400/12 hover:text-emerald-200 transition-colors"
                    title={t('exportConnections')}
                  >
                    <Upload size={12} />
                    <span>Export</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {sidebarCollapsed ? (
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
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
                    }}
                    title={`${conn.name} • ${state}`}
                    className={`relative flex w-full items-center justify-center border px-0 py-1.5 text-xs transition-colors ${
                      isSelected
                        ? 'border-primary/40 bg-primary/16 text-text'
                        : 'border-transparent bg-transparent rounded-lg text-muted hover:bg-background/45 hover:text-text'
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
                    <span
                      className={`absolute left-2 top-2 h-2.5 w-2.5 rounded-full ${connectionStateDot(state)}`}
                      title={translate(locale, connectionStatusLabelKey(state))}
                    />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
              <div className="space-y-1">
                {connections.length === 0 ? (
                  <div className="flex flex-col items-center gap-4 rounded-lg border border-border/50 bg-background/24 px-4 py-8 text-center">
                    <div className="rounded-full border border-border/60 bg-surface/60 p-3 text-muted">
                      <Plug size={22} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text">{t('noSavedConnections')}</p>
                      <p className="mt-1 text-xs text-muted/70">{t('addFirstConnection')}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowForm(true)}
                      className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/12 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/18 transition-colors"
                    >
                      <Plus size={15} />
                      {t('newConnection')}
                    </button>
                  </div>
                ) : (
                  connections.map((conn) => {
                    const isSelected = selectedConnectionId === conn.id;
                    const isFavorite = favoriteConnectionId === conn.id;
                    const connectionState = resolveConnectionState(conn.id);
                    const logsExpanded = logsExpandedByConnection[conn.id] ?? logsExpandedByDefault;

                    return (
                      <div key={conn.id} className="space-y-2">
                        <button
                          type="button"
                          onClick={() => toggleSelectedConnection(conn.id)}
                          onContextMenu={(event) => openConnectionContextMenu(event, conn.id)}
                          className={`group w-full border rounded-lg px-3 py-2 text-left transition-colors ${
                            isSelected
                              ? 'border-primary/35 bg-background/48'
                              : 'border-transparent bg-transparent hover:bg-background/34'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex items-start gap-2">
                              <span
                                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${connectionStateDot(connectionState)}`}
                                title={translate(locale, connectionStatusLabelKey(connectionState))}
                              />
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
                                {isFavorite ? <Star size={13} className="shrink-0 fill-amber-300 text-amber-300" /> : null}
                              </div>
                              <div className="mt-1 truncate text-[11px] text-muted">
                                {conn.engine.toUpperCase()} • {conn.user}@{conn.host}
                                {conn.database ? `/${conn.database}` : ''}
                              </div>
                            </div>
                            </div>
                          </div>
                        </button>

                        {isSelected ? (
                          <div className="space-y-3 border rounded-lg border-border/70 bg-background/18 p-3">
                            <ActionSection
                              title={t('mainActions')}
                              actions={buildPrimaryActions({
                                connectionState,
                                locale,
                                onOpen: () => void openConnection(conn),
                              })}
                            />

                            <LogsSection
                              locale={locale}
                              connectionName={conn.name}
                              expanded={logsExpanded}
                              entries={connectionLogs[conn.id] ?? []}
                              onToggle={() => setLogsExpanded(conn.id, !logsExpanded)}
                              onCopy={() => void copyLogs(conn.id)}
                              onExpand={() => setExpandedLogsConnectionId(conn.id)}
                              copied={copiedLogsId === conn.id}
                            />

                            {activeConnectionId === conn.id ? (
                              <DatabaseExplorer
                                connId={conn.id}
                                dbName={conn.database}
                                engine={conn.engine}
                                showRefreshButton
                              />
                            ) : (
                              <div className="border border-border/60 bg-background/24 px-3 py-3 text-xs text-muted">
                                Abra a conexao para carregar o explorer.
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          <div
            className={`shrink-0 border-border/70 bg-background/26 ${
              sidebarCollapsed ? 'px-1.5 py-2' : 'px-3 py-3'
            }`}
          >
            {connections.length > 0 && (!sidebarCollapsed ? (
              <button
                type="button"
                onClick={() => {
                  setEditingConnectionId(null);
                  setShowForm(true);
                }}
                className="w-full flex items-center justify-center gap-2 mb-2.5 py-2 rounded-lg border border-dashed border-border/60 text-xs font-medium text-muted hover:text-text hover:border-primary/50 hover:bg-primary/6 transition-colors"
                title={t('newConnection')}
              >
                <Plus size={13} />
                {t('newConnection')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingConnectionId(null);
                  setShowForm(true);
                }}
                className="w-full flex items-center justify-center mb-2 py-1.5 rounded-lg border border-dashed border-border/60 text-muted hover:text-text hover:border-primary/50 hover:bg-primary/6 transition-colors"
                title={t('newConnection')}
              >
                <Plus size={14} />
              </button>
            ))}
            <div
              className={`rounded-xl border-border/60 bg-background/36 ${
                sidebarCollapsed
                  ? 'flex items-center justify-center px-1 py-2'
                  : 'px-3 py-2'
              }`}
            >
              <img
                src={sidebarCollapsed ? pulsesqlFooterCompact : pulsesqlFooter}
                alt="PulseSQL"
                className={sidebarCollapsed ? 'h-10 w-auto opacity-95' : 'h-10 w-full object-contain opacity-95'}
              />
            </div>
          </div>
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

        <div className="flex-1 bg-background flex flex-col min-w-0 min-h-0 overflow-hidden">
          {showForm ? (
            <ConnectionForm
              initialConnection={editingConnection}
              onClose={() => {
                setShowForm(false);
                setEditingConnectionId(null);
              }}
            />
          ) : (
            <QueryWorkspace />
          )}
        </div>
      </div>

      {connectionContextMenu ? (
        <div
          className="fixed z-[130] min-w-[180px] rounded-lg border border-border/80 bg-surface/95 p-1 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          style={{ left: connectionContextMenu.x, top: connectionContextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setConnectionContextMenu(null);
              if (contextMenuConnection) {
                void openConnection(contextMenuConnection, contextMenuState === 'connected');
              }
            }}
            disabled={contextMenuState === 'connecting' || contextMenuState === 'reconnecting'}
            className="mb-1 flex w-full items-center gap-2 rounded-lg border border-emerald-400/35 bg-emerald-400/14 px-3 py-2 text-sm font-medium text-emerald-200 transition-colors hover:bg-emerald-400/22 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plug size={14} className="text-emerald-300" />
            <span>
              {contextMenuState === 'connected'
                ? t('reconnectAction')
                : contextMenuState === 'reconnecting'
                  ? t('reconnectingAction')
                  : t('openConnectionAction')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              const connId = connectionContextMenu.connId;
              const isFavorite = favoriteConnectionId === connId;
              setConnectionContextMenu(null);
              setFavoriteConnection(isFavorite ? null : connId);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text transition-colors hover:bg-background/55"
          >
            <Star size={14} className={favoriteConnectionId === connectionContextMenu.connId ? 'fill-amber-300 text-amber-300' : 'text-muted'} />
            <span>{favoriteConnectionId === connectionContextMenu.connId ? t('unfavorite') : t('favoriteAndAutoOpen')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setConnectionContextMenu(null);
              setEditingConnectionId(connectionContextMenu.connId);
              setShowForm(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text transition-colors hover:bg-background/55"
          >
            <FileText size={14} className="text-muted" />
            <span>{t('editConnection')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const conn = connections.find((item) => item.id === connectionContextMenu.connId);
              setConnectionContextMenu(null);
              if (conn) {
                void disconnectConnection(conn);
              }
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text transition-colors hover:bg-background/55"
          >
            <PlugZap size={14} className="text-muted" />
            <span>{t('disconnect')}</span>
          </button>
          <div className="my-1 border-t border-border/70" />
          <button
            type="button"
            onClick={() => {
              const conn = connections.find((item) => item.id === connectionContextMenu.connId);
              setConnectionContextMenu(null);
              if (conn) {
                confirmRemoveConnection(conn);
              }
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-400/10"
          >
            <XCircle size={14} className="text-red-300" />
            <span>{t('remove')}</span>
          </button>
        </div>
      ) : null}

      {expandedLogsConnectionId ? (
        <LogsModal
          locale={locale}
          connectionName={connections.find((item) => item.id === expandedLogsConnectionId)?.name ?? t('favoriteConnection')}
          entries={connectionLogs[expandedLogsConnectionId] ?? []}
          onCopy={() => void copyLogs(expandedLogsConnectionId)}
          onClose={() => setExpandedLogsConnectionId(null)}
          copied={copiedLogsId === expandedLogsConnectionId}
        />
      ) : null}

      <input
        ref={importFileRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={importConnections}
      />

      {exportModalOpen ? createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) { setExportModalOpen(false); setExportSavedPath(null); } }}
        >
          <div className="w-[400px] max-h-[80vh] flex flex-col rounded-xl border border-border/80 bg-surface shadow-2xl">
            <div className="px-5 py-4 border-b border-border/50">
              <h2 className="text-sm font-semibold text-text">{t('exportConnections')}</h2>
              <p className="text-xs text-muted/70 mt-0.5">Select which connections to include in the export file.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1">
              <button
                type="button"
                className="text-xs text-primary hover:underline self-start px-2 mb-1"
                onClick={() => setExportSelectedIds(
                  exportSelectedIds.size === connections.length
                    ? new Set()
                    : new Set(connections.map((c) => c.id))
                )}
              >
                {exportSelectedIds.size === connections.length ? 'Deselect all' : 'Select all'}
              </button>
              {connections.map((conn) => (
                <label
                  key={conn.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-background/40 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={exportSelectedIds.has(conn.id)}
                    onChange={(e) => {
                      setExportSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(conn.id);
                        else next.delete(conn.id);
                        return next;
                      });
                    }}
                    className="accent-primary w-3.5 h-3.5"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-text truncate">{conn.name}</div>
                    <div className="text-xs text-muted/60 truncate">{conn.engine} • {conn.host}</div>
                  </div>
                </label>
              ))}
            </div>
            {exportSavedPath ? (
              <div className="px-5 py-3 border-t border-border/50 flex flex-col gap-3">
                <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-400/10 rounded-lg px-3 py-2.5">
                  <Check size={13} className="shrink-0 mt-0.5" />
                  <span className="break-all">Saved to {exportSavedPath}</span>
                </div>
                <button
                  type="button"
                  onClick={() => { setExportModalOpen(false); setExportSavedPath(null); }}
                  className="w-full rounded-lg bg-primary/20 text-primary text-sm font-medium py-2 hover:bg-primary/30 transition-colors"
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="px-5 py-4 border-t border-border/50 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setExportModalOpen(false); setExportSavedPath(null); }}
                  className="px-4 py-1.5 text-sm text-muted hover:text-text rounded-lg hover:bg-background/40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={exportSelectedIds.size === 0}
                  onClick={() => void confirmExport()}
                  className="px-4 py-1.5 text-sm font-medium rounded-lg bg-primary text-surface hover:bg-primary/85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Export {exportSelectedIds.size > 0 ? `(${exportSelectedIds.size})` : ''}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      ) : null}

      {removeConfirmConn ? createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setRemoveConfirmConn(null); }}
        >
          <div className="w-[380px] rounded-xl border border-border/80 bg-surface shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-border/50">
              <h2 className="text-sm font-semibold text-text">{t('remove')} connection</h2>
            </div>
            <div className="px-5 py-4 text-sm text-muted/80 whitespace-pre-line">
              {t('removeConnectionConfirm', { name: removeConfirmConn.name })}
            </div>
            <div className="px-5 py-4 border-t border-border/50 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setRemoveConfirmConn(null)}
                className="px-4 py-1.5 text-sm text-muted hover:text-text rounded-lg hover:bg-background/40 transition-colors"
              >
                {t('cancelExecution')}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRemoveConnection(removeConfirmConn.id);
                  setRemoveConfirmConn(null);
                }}
                className="px-4 py-1.5 text-sm font-medium rounded-lg bg-red-500/80 text-white hover:bg-red-500 transition-colors"
              >
                {t('remove')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      <div className="shrink-0 rounded-lg border border-border/80 glass-panel px-4 py-1 text-[10px] shadow-[0_18px_42px_rgba(0,0,0,0.2)]">
        <div className="relative flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3 truncate text-text/90">
            <span className="truncate">{statusBarText}</span>
            <span className="hidden sm:inline text-muted/70">•</span>
            <span className="hidden sm:inline text-muted/80">
              {t('semanticBackgroundStatus')}{' '}
              <button
                ref={semanticToggleRef}
                type="button"
                onClick={handleSemanticBackgroundToggle}
                className={`inline text-[10px] uppercase tracking-[0.14em] transition-colors ${
                  semanticBackgroundEnabled ? 'text-primary' : 'text-slate-200/90'
                }`}
              >
                {semanticBackgroundEnabled ? 'ON' : 'OFF'}
              </button>
            </span>
            {serverTimeIndicator ? (
              <>
                <span className="hidden md:inline text-muted/70">•</span>
                <span className="hidden md:inline text-slate-200/90">{serverTimeIndicator}</span>
              </>
            ) : null}
            {showAutocommitIndicator ? (
              <>
                <span className="hidden md:inline text-muted/70">•</span>
                <button
                  type="button"
                  onClick={() => void handleAutocommitStatusBarToggle()}
                  className={`hidden md:inline text-[10px] uppercase tracking-[0.14em] transition-colors ${
                    activeAutocommitEnabled ? 'text-emerald-300' : 'text-amber-300'
                  }`}
                  title={activeAutocommitEnabled ? t('autocommitOn') : t('autocommitOff')}
                >
                  {activeAutocommitEnabled ? t('autocommitOn') : t('autocommitOff')}
                </button>
                {activeTransactionOpen ? (
                  <span className="hidden md:inline text-sky-300/90">{t('transactionOpen')}</span>
                ) : null}
              </>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            className="absolute left-1/2 -translate-x-1/2 text-primary/80 hover:text-primary font-mono tracking-wide transition-colors"
          >
            v{tauriConfig.version}
          </button>
          {statusBarConnection ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="max-w-[220px] truncate text-[10px] uppercase tracking-[0.14em] text-slate-200/90">
                {statusBarConnection.name}
              </span>
              <ConnectionBadge locale={locale} state={statusBarState} compact glowing />
            </div>
          ) : null}
        </div>
      </div>

      {changelogOpen ? createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setChangelogOpen(false); }}
        >
          <div className="w-[520px] max-h-[75vh] flex flex-col rounded-xl border border-border/80 bg-surface shadow-2xl">
            <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-text">Release Notes</h2>
                <p className="text-xs text-primary/80 font-mono mt-0.5">v{tauriConfig.version}</p>
              </div>
              <button
                type="button"
                onClick={() => setChangelogOpen(false)}
                className="text-muted hover:text-text transition-colors text-xs px-2 py-1 rounded hover:bg-background/40"
              >
                {t('close')}
              </button>
            </div>
            <div
              className="flex-1 overflow-y-auto px-5 py-4 text-[12px] leading-relaxed text-muted/90 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-text [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-text/80 [&_h3]:mt-3 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_p]:text-muted/70 first:[&_h2]:mt-0"
              dangerouslySetInnerHTML={{ __html: marked.parse(changelog) as string }}
            />
          </div>
        </div>,
        document.body
      ) : null}
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
  locale,
  onOpen,
}: {
  connectionState: RuntimeConnectionState;
  locale: 'pt-BR' | 'en-US';
  onOpen: () => void;
}): ActionItem[] {
  const isBusy = connectionState === 'connecting' || connectionState === 'reconnecting';
  const actions: ActionItem[] = [];

  if (connectionState !== 'connected') {
    actions.push({
      id: 'open',
      label: connectionState === 'reconnecting'
        ? translate(locale, 'reconnectingAction')
        : translate(locale, 'openConnectionAction'),
      icon: Plug,
      onClick: onOpen,
      disabled: isBusy,
      loading: isBusy,
      tone: 'primary',
    });
  }

  return actions;
}

function LogsSection({
  locale,
  connectionName,
  expanded,
  entries,
  onToggle,
  onCopy,
  onExpand,
  copied = false,
}: {
  locale: 'pt-BR' | 'en-US';
  connectionName: string;
  expanded: boolean;
  entries: string[];
  onToggle: () => void;
  onCopy: () => void;
  onExpand: () => void;
  copied?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/24 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
          <FileText size={12} />
          {translate(locale, 'technicalHistory')}
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/30 px-3 py-1.5 text-xs text-text hover:bg-border/30"
        >
          {expanded ? <EyeOff size={12} /> : <Eye size={12} />}
          {expanded ? translate(locale, 'hide') : translate(locale, 'show')}
        </button>
      </div>

      {expanded ? (
        <div className="mt-3">
          <div className="mb-2 flex items-center justify-end gap-1.5 text-xs text-muted">
            <button
              onClick={onExpand}
              className="inline-flex items-center rounded-lg border border-border px-2 py-1 text-[11px] text-muted hover:text-text hover:bg-border/30"
              title={`${translate(locale, 'logs')} ${connectionName}`}
            >
              <Expand size={11} />
            </button>
            <button
              onClick={onCopy}
              className={`inline-flex items-center rounded-lg border px-2 py-1 text-[11px] transition-colors hover:bg-border/30 ${copied ? 'border-emerald-400/40 text-emerald-300' : 'border-border text-muted hover:text-text'}`}
              title={translate(locale, 'copyLogs')}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          </div>
          {entries.length ? (
            <div className="max-h-40 overflow-auto space-y-1 font-mono text-[11px]">
              {entries.map((entry, index) => {
                const previousTimestamp = index > 0 ? extractLogParts(entries[index - 1]).timestamp : null;
                return (
                <ConnectionLogEntry
                  locale={locale}
                  key={`log-${index}`}
                  entry={entry}
                  highlighted={index === 0}
                  compactTimestamp={Boolean(previousTimestamp && previousTimestamp === extractLogParts(entry).timestamp)}
                />
                );
              })}
            </div>
          ) : (
            <div className="text-[11px] text-muted/70">{translate(locale, 'noLogsYet')}</div>
          )}
        </div>
      ) : null}
    </div>
  );
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

function connectionStatusLabelKey(state: RuntimeConnectionState) {
  const labels: Record<
    RuntimeConnectionState,
    'statusDisconnected' | 'statusConnecting' | 'statusConnected' | 'statusReconnecting' | 'statusFailed'
  > = {
    disconnected: 'statusDisconnected',
    connecting: 'statusConnecting',
    connected: 'statusConnected',
    reconnecting: 'statusReconnecting',
    failed: 'statusFailed',
  };

  return labels[state];
}

function ConnectionBadge({
  locale,
  state,
  compact = false,
  glowing = false,
}: {
  locale: 'pt-BR' | 'en-US';
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
    disconnected: translate(locale, 'statusDisconnected'),
    connecting: translate(locale, 'statusConnecting'),
    connected: translate(locale, 'statusConnected'),
    reconnecting: translate(locale, 'statusReconnecting'),
    failed: translate(locale, 'statusFailed'),
  };

  const compactGlowingConnected =
    state === 'connected' && compact && glowing
      ? 'border-emerald-400/20 bg-emerald-400/8 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.12)]'
      : null;

  return (
    <span
      className={`inline-flex items-center rounded-full border ${
        compact ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]'
      } font-medium uppercase tracking-[0.14em] ${
        compactGlowingConnected ?? palette[state]
      } ${glowing && !compactGlowingConnected ? 'shadow-[0_0_16px_rgba(255,255,255,0.08)]' : ''}`}
    >
      <Dot size={12} className="-ml-0.5 mr-0.5" />
      <span>{labels[state]}</span>
    </span>
  );
}

function LogsModal({
  locale,
  connectionName,
  entries,
  onCopy,
  onClose,
  copied = false,
}: {
  locale: 'pt-BR' | 'en-US';
  connectionName: string;
  entries: string[];
  onCopy: () => void;
  onClose: () => void;
  copied?: boolean;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-background/72 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[78vh] w-full max-w-5xl flex-col rounded-lg border border-border bg-surface/95 shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-text">{translate(locale, 'logs')}</div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">{connectionName}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className={`inline-flex items-center rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:bg-border/30 ${copied ? 'border-emerald-400/40 text-emerald-300' : 'border-border text-muted hover:text-text'}`}
              title={translate(locale, 'copyLogs')}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
            >
              {translate(locale, 'close')}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {entries.length ? (
            <div className="space-y-1.5 font-mono text-[12px]">
              {entries.map((entry, index) => {
                const previousTimestamp = index > 0 ? extractLogParts(entries[index - 1]).timestamp : null;
                return (
                  <ConnectionLogEntry
                    locale={locale}
                    key={`modal-log-${index}`}
                    entry={entry}
                    highlighted={index === 0}
                    compactTimestamp={Boolean(previousTimestamp && previousTimestamp === extractLogParts(entry).timestamp)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 bg-background/40 px-4 py-5 text-sm text-muted">
              {translate(locale, 'noLogsYet')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ConnectionLogEntry({
  locale,
  entry,
  highlighted = false,
  compactTimestamp = false,
}: {
  locale: 'pt-BR' | 'en-US';
  entry: string;
  highlighted?: boolean;
  compactTimestamp?: boolean;
}) {
  const { timestamp, message } = extractLogParts(entry);
  const tone = resolveLogTone(message);
  const Icon = tone.icon;
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  const handleCopyLine = () => {
    navigator.clipboard.writeText(message).catch(() => null);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    setCopied(true);
    copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className={`group rounded-lg px-2.5 py-2 whitespace-pre-wrap break-words ${
        highlighted
          ? `${tone.highlight} shadow-[inset_2px_0_0_rgba(34,199,255,0.55)]`
          : tone.base
      }`}
    >
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 shrink-0 ${tone.iconTone}`}>
          <Icon size={13} />
        </div>
        <div className="min-w-0 flex-1">
          {timestamp ? (
            <div
              className={`mb-1 text-[10px] ${
                compactTimestamp ? 'text-muted/25' : highlighted ? 'text-primary/60' : 'text-muted/45'
              }`}
            >
              {compactTimestamp ? translate(locale, 'sameInstant') : timestamp}
            </div>
          ) : null}
          <div className={tone.text}>{message}</div>
        </div>
        <button
          type="button"
          onClick={handleCopyLine}
          className={`shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
            copied ? 'text-emerald-300' : 'text-muted hover:text-text'
          }`}
          title={translate(locale, 'copyLogs')}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      </div>
    </div>
  );
}

function extractLogParts(entry: string) {
  const match = entry.match(/^(\[[^\]]+\])\s*(.*)$/);
  return {
    timestamp: match?.[1] ?? null,
    message: match?.[2] ?? entry,
  };
}

function resolveLogTone(message: string) {
  const lower = message.toLowerCase();

  if (
    lower.includes('sucesso') ||
    lower.includes('restabelecida') ||
    lower.includes('connection successful') ||
    lower.includes('logs copiados')
  ) {
    return {
      icon: CheckCircle2,
      iconTone: 'text-emerald-300/90',
      text: 'text-emerald-100/95',
      base: 'border border-emerald-400/10 bg-emerald-400/6',
      highlight: 'border border-emerald-400/18 bg-emerald-400/8',
    };
  }

  if (
    lower.includes('erro') ||
    lower.includes('falha') ||
    lower.includes('reset') ||
    lower.includes('refused') ||
    lower.includes('timed out')
  ) {
    return {
      icon: CircleAlert,
      iconTone: 'text-red-300/90',
      text: 'text-red-100/95',
      base: 'border border-red-400/10 bg-red-400/6',
      highlight: 'border border-red-400/18 bg-red-400/8',
    };
  }

  if (lower.includes('tentativa') || lower.includes('reconectando')) {
    return {
      icon: CircleAlert,
      iconTone: 'text-amber-300/90',
      text: 'text-amber-100/95',
      base: 'border border-amber-400/10 bg-amber-400/6',
      highlight: 'border border-amber-400/18 bg-amber-400/8',
    };
  }

  return {
    icon: Info,
    iconTone: 'text-sky-300/80',
    text: 'text-muted',
    base: 'border border-border/40 bg-background/25',
    highlight: 'border border-primary/18 bg-primary/8',
  };
}

function formatConnectionError(error: unknown, locale: 'pt-BR' | 'en-US'): string {
  const raw = extractErrorMessage(error);
  const normalized = raw.trim();
  const lower = normalized.toLowerCase();

  if (lower.includes('timed out')) {
    return locale === 'en-US'
      ? 'Connection open timed out.'
      : 'Tempo limite excedido ao abrir a conexao.';
  }

  if (lower.includes('connection reset')) {
    return locale === 'en-US'
      ? 'The connection was closed by the server during the handshake.'
      : 'A conexao foi encerrada pelo servidor durante o handshake.';
  }

  if (lower.includes('connection refused')) {
    return locale === 'en-US'
      ? 'The host refused the connection. Check host, port, and tunnel.'
      : 'O host recusou a conexao. Verifique host, porta e tunnel.';
  }

  if (lower.includes('authentication failed') || lower.includes('access denied')) {
    return locale === 'en-US'
      ? 'Authentication failed. Review username, password, or private key.'
      : 'Falha de autenticacao. Revise usuario, senha ou chave privada.';
  }

  if (lower.includes('connection not found')) {
    return locale === 'en-US'
      ? 'The connection is not available in the runtime. Open or reconnect before continuing.'
      : 'A conexao nao esta disponivel no runtime. Abra ou reconecte antes de continuar.';
  }

  if (
    lower.includes('unable to locate a java runtime') ||
    lower.includes('java/jdk') ||
    lower.includes('failed to compile oracle jdbc sidecar') ||
    lower.includes('failed to run javac for oracle sidecar')
  ) {
    return locale === 'en-US'
      ? 'Oracle connections require Java/JDK installed on the machine. Install a JDK and try again.'
      : 'Conexao Oracle requer Java/JDK instalado na maquina. Instale um JDK e tente novamente.';
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
