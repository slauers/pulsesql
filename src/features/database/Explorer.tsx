import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronRight,
  Columns,
  CopyPlus,
  Crosshair,
  Database,
  EllipsisVertical,
  FilePenLine,
  FileSearch,
  Pin,
  Rows4,
  Table2,
} from 'lucide-react';
import PulseLoader from '../../components/ui/PulseLoader';
import { type DatabaseEngine, useConnectionsStore, getConnectionColor } from '../../store/connections';
import { useDatabaseSessionStore } from '../../store/databaseSession';
import { useConnectionRuntimeStore } from '../../store/connectionRuntime';
import { useQueriesStore } from '../../store/queries';
import {
  ensureColumnsCached,
  ensureSchemasCached,
  ensureTablesCached,
  invalidateMetadataCache,
} from './metadata-cache';
import {
  buildCreateTableTemplate,
  buildCountRowsQuery,
  buildInsertTemplate,
  buildSelectTopQuery,
  buildUpdateTemplate,
  type ExplorerActionId,
} from './sql-generation';
import type { MetadataColumn } from './types';

interface DatabaseExplorerProps {
  connId: string;
  dbName: string;
  engine: DatabaseEngine;
  showRefreshButton?: boolean;
  refreshToken?: number;
  onConnect?: () => void;
}

interface TableContextMenuState {
  x: number;
  y: number;
  schema: string;
  table: string;
}

interface SchemaContextMenuState {
  x: number;
  y: number;
  schema: string;
}

interface DescribeState {
  schema: string;
  table: string;
  columns: MetadataColumn[];
}

const EXPLORER_ACTIONS: Array<{
  id: ExplorerActionId;
  label: string;
  icon: typeof Rows4;
}> = [
  { id: 'selectTop100', label: 'Select top 100', icon: Rows4 },
  { id: 'countRows', label: 'Count rows', icon: Database },
  { id: 'describeTable', label: 'Describe table', icon: FileSearch },
  { id: 'update', label: 'Update', icon: FilePenLine },
  { id: 'insert', label: 'Insert', icon: CopyPlus },
];

const MENU_OFFSET_PX = 4;
const TABLE_MENU_WIDTH = 190;
const SCHEMA_MENU_WIDTH = 220;

export function DatabaseExplorer({
  connId,
  dbName: _dbName,
  engine,
  showRefreshButton = true,
  refreshToken = 0,
  onConnect,
}: DatabaseExplorerProps) {
  const metadataConnection = useDatabaseSessionStore((state) => state.metadataByConnection[connId]);
  const activeSchema = useDatabaseSessionStore((state) => state.activeSchemaByConnection[connId] ?? null);
  const setActiveSchema = useDatabaseSessionStore((state) => state.setActiveSchema);
  const connection = useConnectionsStore((state) => state.connections.find((item) => item.id === connId) ?? null);
  const connectionColor = useConnectionsStore((state) => getConnectionColor(state.connections, connId));
  const setActiveConnection = useConnectionsStore((state) => state.setActiveConnection);
  const updateConnection = useConnectionsStore((state) => state.updateConnection);
  const addTabWithContent = useQueriesStore((state) => state.addTabWithContent);
  const replaceActiveTabContent = useQueriesStore((state) => state.replaceActiveTabContent);
  const requestTabExecution = useQueriesStore((state) => state.requestTabExecution);
  const runtimeStatus = useConnectionRuntimeStore((state) => state.runtimeStatus[connId] ?? 'disconnected');

  const [loading, setLoading] = useState(true);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [contextMenu, setContextMenu] = useState<TableContextMenuState | null>(null);
  const [schemaContextMenu, setSchemaContextMenu] = useState<SchemaContextMenuState | null>(null);
  const [describeState, setDescribeState] = useState<DescribeState | null>(null);

  const isConnecting = runtimeStatus === 'connecting' || runtimeStatus === 'reconnecting';
  const isConnected = runtimeStatus === 'connected';
  const canLoadMetadata = isConnected || isConnecting;
  const hasConnectionError = runtimeStatus === 'failed';
  const showHeartbeat = isConnecting || (isConnected && loading);

  useEffect(() => {
    if (!isConnected) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);
    ensureSchemasCached(connId, engine, {
      force: refreshToken > 0,
      markActive: true,
    })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isConnected, connId, engine, refreshToken]);

  useEffect(() => {
    const handlePointerDown = () => {
      setContextMenu(null);
      setSchemaContextMenu(null);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
        setSchemaContextMenu(null);
        setDescribeState(null);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const schemas = metadataConnection?.schemas ?? [];
  const schemaError = metadataConnection?.schemasError;
  const preferredSchema = connection?.preferredSchema ?? null;
  const resolvedSchema = activeSchema ?? preferredSchema ?? schemas[0] ?? null;
  const schemaEntry = resolvedSchema ? metadataConnection?.schemasByName[resolvedSchema] : undefined;
  const tables = schemaEntry?.tables ?? [];
  const tablesError = schemaEntry?.tablesError ?? null;

  useEffect(() => {
    if (!canLoadMetadata || !resolvedSchema) {
      setTablesLoading(false);
      return;
    }

    let cancelled = false;
    setTablesLoading(true);

    ensureTablesCached(connId, engine, resolvedSchema)
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setTablesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canLoadMetadata, connId, engine, resolvedSchema]);

  const handleRefresh = async () => {
    if (!canLoadMetadata) {
      onConnect?.();
      return;
    }

    setRefreshing(true);
    invalidateMetadataCache(connId);
    try {
      await ensureSchemasCached(connId, engine, { force: true, markActive: true });
    } finally {
      setRefreshing(false);
    }
  };

  const openQueryFromExplorer = async (action: ExplorerActionId, schema: string, table: string, newTab = false) => {
    const columns =
      action === 'insert' || action === 'update' || action === 'describeTable'
        ? await ensureColumnsCached(connId, engine, schema, table, { priority: true }).catch(() => [])
        : undefined;

    if (action === 'describeTable') {
      setDescribeState({
        schema,
        table,
        columns: columns ?? [],
      });
      return;
    }

    // No schema prefix on generated queries — keep it simple
    const reference = { table };
    const sql =
      action === 'selectTop100'
        ? buildSelectTopQuery(engine, reference)
        : action === 'countRows'
          ? buildCountRowsQuery(reference)
          : action === 'insert'
            ? buildInsertTemplate(engine, reference, columns)
            : buildUpdateTemplate(reference);

    setActiveConnection(connId);
    setActiveSchema(connId, schema);

    if (action === 'selectTop100') {
      if (newTab) {
        const tabId = addTabWithContent(sql, `${table} ${resolveActionTitle(action)}`, connId);
        requestTabExecution(tabId);
      } else {
        const tabId = replaceActiveTabContent(sql, `${table} ${resolveActionTitle(action)}`, connId);
        if (tabId) {
          requestTabExecution(tabId);
        }
      }
      return;
    }

    addTabWithContent(sql, `${table} ${resolveActionTitle(action)}`, connId);
  };

  const openCreateTableTemplate = (schema: string) => {
    const sql = buildCreateTableTemplate({ schema, table: 'new_table' });
    setActiveConnection(connId);
    addTabWithContent(sql, `${schema} create table`, connId);
    setActiveSchema(connId, schema);
    setSchemaContextMenu(null);
  };

  return (
    <div className="relative flex h-full flex-col bg-surface/35">
      {canLoadMetadata ? (
        <div className="flex items-center gap-2 border-b border-border/60" style={{ padding: '10px 14px 9px' }}>
          <div className="flex-1 h-px bg-border/60" />
          <button
            type="button"
            onClick={(event) => {
              if (!resolvedSchema) return;
              event.stopPropagation();
              setSchemaContextMenu({
                x: event.clientX,
                y: event.clientY,
                schema: resolvedSchema,
              });
            }}
            disabled={!resolvedSchema}
            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/30 px-2 py-1 text-muted transition-colors hover:bg-background/45 hover:text-text disabled:pointer-events-none disabled:opacity-0"
            style={{ fontSize: 9.5 }}
            title={resolvedSchema ?? ''}
          >
            <span className="max-w-[110px] truncate">{resolvedSchema ?? ''}</span>
            <ChevronDown size={11} />
          </button>
          {showRefreshButton ? (
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="text-muted hover:text-text transition-colors"
              title="Atualizar metadata"
            >
              <RefreshIcon size={12} spinning={refreshing} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {!canLoadMetadata ? (
          <DisconnectedExplorerState
            hasConnectionError={hasConnectionError}
            isConnecting={isConnecting}
            onConnect={onConnect}
          />
        ) : showHeartbeat ? (
          <HeartbeatLoader color={connectionColor} />
        ) : schemaError ? (
          <ExplorerError message={schemaError} onRetry={() => void handleRefresh()} />
        ) : !resolvedSchema ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted/75">
            Nenhum schema encontrado para esta conexao.
          </div>
        ) : tablesLoading && !tables.length ? (
          <HeartbeatLoader color={connectionColor} />
        ) : tablesError ? (
          <ExplorerError message={tablesError} onRetry={() => void handleRefresh()} />
        ) : tables.length ? (
          <div className="space-y-1">
            {tables.map((table) => (
              <FlatTableItem
                key={table}
                connId={connId}
                engine={engine}
                schema={resolvedSchema}
                table={table}
                onOpenAction={(action) => void openQueryFromExplorer(action, resolvedSchema, table, action === 'selectTop100')}
                onOpenContextMenu={(event) => {
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    schema: resolvedSchema,
                    table,
                  });
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted/75">
            Nenhuma tabela encontrada neste schema.
          </div>
        )}
      </div>

      {contextMenu
        ? createPortal(
	            <div
	              className="pulsesql-menu fixed z-[120] min-w-[190px] rounded-lg border p-1"
	              style={{
	                ...buildMenuPosition(contextMenu.x, contextMenu.y, TABLE_MENU_WIDTH),
	                '--pulsesql-accent': connectionColor,
	              } as CSSProperties}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {EXPLORER_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      void openQueryFromExplorer(action.id, contextMenu.schema, contextMenu.table);
                    }}
	                    className="pulsesql-menu-item flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors hover:bg-primary/10 hover:text-text"
                  >
                    <Icon size={13} className="text-muted shrink-0" />
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}

      {schemaContextMenu
        ? createPortal(
	            <div
	              className="pulsesql-menu fixed z-[120] min-w-[220px] rounded-lg border p-1"
	              style={{
	                ...buildMenuPosition(schemaContextMenu.x, schemaContextMenu.y, SCHEMA_MENU_WIDTH),
	                '--pulsesql-accent': connectionColor,
	              } as CSSProperties}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {schemas.map((schema) => (
                <button
                  key={schema}
                  type="button"
                  onClick={() => {
                    setActiveSchema(connId, schema);
                    setSchemaContextMenu(null);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors ${
	                    schema === resolvedSchema ? 'bg-primary/12 text-primary' : 'pulsesql-menu-item hover:bg-primary/10 hover:text-text'
                  }`}
                >
                  <Crosshair size={13} className="text-muted shrink-0" />
                  <span className="flex-1 truncate text-left">{schema}</span>
                  {preferredSchema === schema ? (
                    <span className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-muted">
                      default
                    </span>
                  ) : null}
                </button>
              ))}
              <div className="my-1 border-t border-border/50" />
              <button
                type="button"
                onClick={() => openCreateTableTemplate(schemaContextMenu.schema)}
	                className="pulsesql-menu-item flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors hover:bg-primary/10 hover:text-text"
              >
                <Table2 size={13} className="text-muted shrink-0" />
                <span>Criar tabela neste schema</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (connection) {
                    updateConnection({
                      ...connection,
                      preferredSchema: schemaContextMenu.schema,
                    });
                  }
                  setActiveSchema(connId, schemaContextMenu.schema);
                  setSchemaContextMenu(null);
                }}
	                className="pulsesql-menu-item flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors hover:bg-primary/10 hover:text-text"
              >
                <Pin size={13} className="text-muted shrink-0" />
                <span>Tornar schema padrao</span>
              </button>
            </div>,
            document.body,
          )
        : null}

      {describeState ? (
        <DescribeTableModal
          engine={engine}
          schema={describeState.schema}
          table={describeState.table}
          columns={describeState.columns}
          onClose={() => setDescribeState(null)}
        />
      ) : null}
    </div>
  );
}

function HeartbeatLoader({ color }: { color: string }) {
  return (
    <div className="flex h-full items-center justify-center py-8">
      <PulseLoader color={color} message="Carregando..." size="md" surface="transparent" />
    </div>
  );
}

function DisconnectedExplorerState({
  hasConnectionError,
  isConnecting,
  onConnect,
}: {
  hasConnectionError: boolean;
  isConnecting: boolean;
  onConnect?: () => void;
}) {
  return (
    <div className="flex h-full items-start justify-center px-3 py-6 text-center">
      <div className="flex w-full max-w-[220px] flex-col items-center gap-3">
        {hasConnectionError ? (
          <div className="space-y-1">
            <div className="text-xs font-medium text-red-200/90">Erro ao conectar</div>
            <div className="text-[11px] text-muted/75">Check logs.</div>
          </div>
        ) : null}
      <button
        type="button"
        disabled={isConnecting || !onConnect}
        onClick={onConnect}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border/70 bg-background/35 px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-primary/20 hover:bg-primary/5 hover:text-text disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isConnecting ? <PulseLoader color="currentColor" size="xs" surface="transparent" /> : null}
        {isConnecting ? 'Conectando...' : hasConnectionError ? 'Tentar novamente' : 'Conectar'}
      </button>
      </div>
    </div>
  );
}

function RefreshIcon({ size, spinning }: { size: number; spinning: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function buildTableMetaLabel(columnCount?: number) {
  if (typeof columnCount === 'number' && columnCount > 0) {
    return `${columnCount}c`;
  }

  return '--';
}

function FlatTableItem({
  connId,
  engine,
  schema,
  table,
  onOpenAction,
  onOpenContextMenu,
}: {
  connId: string;
  engine: DatabaseEngine;
  schema: string;
  table: string;
  onOpenAction: (action: ExplorerActionId) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const tableEntry = useDatabaseSessionStore(
    (state) => state.metadataByConnection[connId]?.schemasByName[schema]?.tablesByName[table],
  );
  const connectionColor = useConnectionsStore((state) => getConnectionColor(state.connections, connId));
  const [expanded, setExpanded] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState(false);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    if (tableEntry?.columns?.length) {
      return;
    }

    let cancelled = false;
    setLoadingColumns(true);

    ensureColumnsCached(connId, engine, schema, table, { priority: true })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setLoadingColumns(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connId, engine, expanded, schema, table, tableEntry?.columns?.length]);

  const columns = tableEntry?.columns ?? [];
  const metaLabel = buildTableMetaLabel(columns.length);

  return (
    <div className="rounded-lg">
      <div
        className="group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-background/38"
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu(event);
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          onDoubleClick={() => onOpenAction('selectTop100')}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          title={`${schema}.${table}`}
        >
          {expanded ? (
            <ChevronDown size={12} className="shrink-0 text-muted" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-muted" />
          )}
          <Table2 size={13} className="shrink-0 text-muted" />
          <span className="truncate font-mono text-[13px] text-text">{table}</span>
        </button>
        <span className="shrink-0 text-[11px] font-mono text-muted/70">{metaLabel}</span>
        <button
          type="button"
          onClick={onOpenContextMenu}
          className="rounded p-1 text-muted opacity-0 transition-opacity hover:bg-background/60 hover:text-text group-hover:opacity-100"
          title="Acoes da tabela"
        >
          <EllipsisVertical size={12} />
        </button>
      </div>

      {expanded ? (
        <div className="ml-5 border-l border-border/40 pl-3">
          {loadingColumns && !columns.length ? (
            <div className="flex items-center gap-2 py-2 text-[11px] text-muted">
              <PulseLoader color={connectionColor} message="Carregando colunas..." size="sm" surface="transparent" />
            </div>
          ) : tableEntry?.columnsError ? (
            <div className="py-2 text-[11px] text-red-300">{tableEntry.columnsError}</div>
          ) : columns.length ? (
            <div className="py-1">
              {columns.map((column) => (
                <div
                  key={column.columnName}
                  className="flex items-center gap-2 py-1.5 text-[12px] text-muted/90"
                  title={`${column.columnName} • ${column.dataType}`}
                >
                  <Columns size={12} className="shrink-0 text-muted/70" />
                  <span className="min-w-0 flex-1 truncate font-mono text-text/90">{column.columnName}</span>
                  <span className="shrink-0 text-[10px] font-mono text-muted/65">{column.dataType}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 text-[11px] text-muted/70">Nenhuma coluna encontrada.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DescribeTableModal({
  engine,
  schema,
  table,
  columns,
  onClose,
}: {
  engine: DatabaseEngine;
  schema: string;
  table: string;
  columns: MetadataColumn[];
  onClose: () => void;
}) {
  const description = useMemo(
    () => `${engine.toUpperCase()} • ${schema} • ${table}`,
    [engine, schema, table],
  );
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return createPortal(
	    <div
	      className="pulsesql-overlay fixed inset-0 z-[140] flex items-center justify-center p-6"
	      onMouseDown={onClose}
	    >
	      <div
	        className="pulsesql-dialog w-full max-w-5xl rounded-lg border"
	        onMouseDown={(event) => event.stopPropagation()}
	      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-text">Describe table</div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">{description}</div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
          >
            Fechar
          </button>
        </div>

        <div className="max-h-[78vh] overflow-auto p-4">
          {columns.length ? (
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.12em] text-muted">
                  <th className="border-b border-border px-3 py-2">Column</th>
                  <th className="border-b border-border px-3 py-2">Type</th>
                  <th className="border-b border-border px-3 py-2">Nullable</th>
                  <th className="border-b border-border px-3 py-2">Default</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((column) => (
                  <tr key={column.columnName} className="text-text">
                    <td className="border-b border-border/60 px-3 py-2 font-medium">{column.columnName}</td>
                    <td className="border-b border-border/60 px-3 py-2 text-muted">{column.dataType}</td>
                    <td className="border-b border-border/60 px-3 py-2 text-muted">
                      {column.nullable === null ? 'Unknown' : column.nullable ? 'Yes' : 'No'}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 font-mono text-xs text-muted">
                      {column.defaultValue ?? 'NULL'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="rounded-lg border border-border/70 bg-background/40 px-4 py-5 text-sm text-muted">
              Nao foi possivel montar a descricao desta tabela com a metadata atual.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ExplorerError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-400/20 bg-red-400/8 p-3 text-sm text-red-300">
      <div>{message}</div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-xs text-muted hover:text-text underline underline-offset-2"
        >
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

function resolveActionTitle(action: ExplorerActionId): string {
  switch (action) {
    case 'countRows':
      return 'Count';
    case 'insert':
      return 'Insert';
    case 'update':
      return 'Update';
    case 'describeTable':
      return 'Describe';
    case 'selectTop100':
    default:
      return 'Select';
  }
}

function buildMenuPosition(x: number, y: number, menuWidth: number) {
  const menuHeight = 210;
  const left = Math.max(8, Math.min(x + MENU_OFFSET_PX, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(y + MENU_OFFSET_PX, window.innerHeight - menuHeight - 8));
  return { left, top };
}
