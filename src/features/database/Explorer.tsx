import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
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
  LayoutTemplate,
  LoaderCircle,
  RefreshCw,
  Rows4,
  Table2,
} from 'lucide-react';
import { type DatabaseEngine, useConnectionsStore } from '../../store/connections';
import { useDatabaseSessionStore } from '../../store/databaseSession';
import { useQueriesStore } from '../../store/queries';
import {
  ensureColumnsCached,
  ensureSchemasCached,
  ensureTablesCached,
  invalidateMetadataCache,
} from './metadata-cache';
import {
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

const MENU_OFFSET_PX = 8;
const TABLE_MENU_WIDTH = 190;
const SCHEMA_MENU_WIDTH = 220;

export function DatabaseExplorer({
  connId,
  dbName,
  engine,
  showRefreshButton = true,
  refreshToken = 0,
}: DatabaseExplorerProps) {
  const metadataConnection = useDatabaseSessionStore((state) => state.metadataByConnection[connId]);
  const activeSchema = useDatabaseSessionStore((state) => state.activeSchemaByConnection[connId] ?? null);
  const setActiveSchema = useDatabaseSessionStore((state) => state.setActiveSchema);
  const connection = useConnectionsStore((state) => state.connections.find((item) => item.id === connId) ?? null);
  const updateConnection = useConnectionsStore((state) => state.updateConnection);
  const addTabWithContent = useQueriesStore((state) => state.addTabWithContent);
  const replaceActiveTabContent = useQueriesStore((state) => state.replaceActiveTabContent);
  const requestTabExecution = useQueriesStore((state) => state.requestTabExecution);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [contextMenu, setContextMenu] = useState<TableContextMenuState | null>(null);
  const [schemaContextMenu, setSchemaContextMenu] = useState<SchemaContextMenuState | null>(null);
  const [describeState, setDescribeState] = useState<DescribeState | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    ensureSchemasCached(connId, engine, refreshToken > 0 ? { force: true } : undefined)
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connId, engine, refreshToken]);

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

  const handleRefresh = async () => {
    setRefreshing(true);
    invalidateMetadataCache(connId);
    try {
      await ensureSchemasCached(connId, engine, { force: true });
    } finally {
      setRefreshing(false);
    }
  };

  const openQueryFromExplorer = async (action: ExplorerActionId, schema: string, table: string) => {
    const columns =
      action === 'insert' || action === 'update' || action === 'describeTable'
        ? await ensureColumnsCached(connId, engine, schema, table).catch(() => [])
        : undefined;

    if (action === 'describeTable') {
      setDescribeState({
        schema,
        table,
        columns: columns ?? [],
      });
      return;
    }

    const reference = { schema, table };
    const sql =
      action === 'selectTop100'
        ? buildSelectTopQuery(engine, reference)
        : action === 'countRows'
          ? buildCountRowsQuery(reference)
          : action === 'insert'
            ? buildInsertTemplate(engine, reference, columns)
            : buildUpdateTemplate(reference);

    if (action === 'selectTop100') {
      const tabId = replaceActiveTabContent(sql, `${table} ${resolveActionTitle(action)}`);
      if (tabId) {
        requestTabExecution(tabId);
      }
      return;
    }

    addTabWithContent(sql, `${table} ${resolveActionTitle(action)}`);
  };

  return (
    <div className="flex flex-col h-full bg-surface relative">
      <div className="p-3 border-b border-border bg-background/50 flex items-center gap-2">
        <Database size={16} className="text-primary" />
        <span className="font-semibold text-sm truncate">{dbName}</span>
        {activeSchema ? (
          <span className="ml-auto rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted">
            {activeSchema}
          </span>
        ) : null}
        {showRefreshButton ? (
          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="rounded-lg border border-border/70 p-1.5 text-muted hover:bg-border/30 hover:text-text"
            title="Atualizar metadata"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex justify-center p-4">
            <LoaderCircle size={18} className="animate-spin text-muted" />
          </div>
        ) : schemaError ? (
          <ExplorerError message={schemaError} />
        ) : schemas.length ? (
          <div className="mt-2">
            {schemas.map((schema) => (
              <SchemaItem
                key={schema}
                connId={connId}
                engine={engine}
                schema={schema}
                active={activeSchema === schema}
                preferred={preferredSchema === schema}
                onActivate={() => setActiveSchema(connId, schema)}
                onOpenSchemaContextMenu={(event) =>
                  setSchemaContextMenu({
                    ...resolveMenuAnchor(event, SCHEMA_MENU_WIDTH),
                    schema,
                  })
                }
                onOpenAction={(action, table) => void openQueryFromExplorer(action, schema, table)}
                onOpenContextMenu={(event, table) =>
                  setContextMenu({
                    ...resolveMenuAnchor(event, TABLE_MENU_WIDTH),
                    schema,
                    table,
                  })
                }
              />
            ))}
          </div>
        ) : (
          <div className="p-3 text-sm text-muted">Nenhum schema encontrado.</div>
        )}
      </div>

      {contextMenu
        ? createPortal(
            <div
              className="fixed z-[120] min-w-[190px] rounded-lg border border-border/80 bg-surface/95 p-1 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
              style={buildMenuPosition(contextMenu.x, contextMenu.y, TABLE_MENU_WIDTH)}
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
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text transition-colors hover:bg-background/55"
                  >
                    <Icon size={14} className="text-muted" />
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
              className="fixed z-[120] min-w-[220px] rounded-lg border border-border/80 bg-surface/95 p-1 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
              style={buildMenuPosition(schemaContextMenu.x, schemaContextMenu.y, SCHEMA_MENU_WIDTH)}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveSchema(connId, schemaContextMenu.schema);
                  setSchemaContextMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text transition-colors hover:bg-background/55"
              >
                <Crosshair size={14} className="text-muted" />
                <span>Usar neste editor</span>
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
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-text transition-colors hover:bg-background/55"
              >
                <Pin size={14} className="text-muted" />
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

function SchemaItem({
  connId,
  engine,
  schema,
  active,
  preferred,
  onActivate,
  onOpenSchemaContextMenu,
  onOpenAction,
  onOpenContextMenu,
}: {
  connId: string;
  engine: DatabaseEngine;
  schema: string;
  active: boolean;
  preferred: boolean;
  onActivate: () => void;
  onOpenSchemaContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onOpenAction: (action: ExplorerActionId, table: string) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>, table: string) => void;
}) {
  const schemaEntry = useDatabaseSessionStore((state) => state.metadataByConnection[connId]?.schemasByName[schema]);
  const [expanded, setExpanded] = useState(schema === 'public' || active);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (active) {
      setExpanded(true);
    }
  }, [active]);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    onActivate();
    ensureTablesCached(connId, engine, schema)
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connId, engine, expanded, onActivate, schema]);

  return (
    <div>
      <div
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenSchemaContextMenu(event);
        }}
        onClick={() => {
          onActivate();
          setExpanded((current) => !current);
        }}
        className={`flex items-center gap-1.5 py-1.5 px-2 rounded cursor-pointer select-none ${
          active ? 'bg-primary/10 text-primary' : 'text-text hover:bg-border/30'
        }`}
      >
        {expanded ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
        <LayoutTemplate size={15} className="text-amber-400" />
        <span className="text-sm font-medium">{schema}</span>
        {preferred ? (
          <span className="ml-auto rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-muted">
            padrao
          </span>
        ) : null}
      </div>

      {expanded ? (
        loading && !schemaEntry?.tables.length ? (
          <div className="ml-6 py-1">
            <LoaderCircle size={14} className="animate-spin text-muted" />
          </div>
        ) : schemaEntry?.tablesError ? (
          <div className="ml-5 border-l border-border/50 pl-3 py-2 text-xs text-red-300">
            {schemaEntry.tablesError}
          </div>
        ) : (
          <div className="ml-5 border-l border-border/50 pl-2">
            {schemaEntry?.tables.map((table) => (
              <TableItem
                key={table}
                connId={connId}
                engine={engine}
                schema={schema}
                table={table}
                onOpenAction={onOpenAction}
                onOpenContextMenu={onOpenContextMenu}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function TableItem({
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
  onOpenAction: (action: ExplorerActionId, table: string) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>, table: string) => void;
}) {
  const tableEntry = useDatabaseSessionStore(
    (state) => state.metadataByConnection[connId]?.schemasByName[schema]?.tablesByName[table],
  );
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    ensureColumnsCached(connId, engine, schema, table)
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connId, engine, expanded, schema, table]);

  return (
    <div>
      <div
        className="group flex items-center gap-1.5 py-1 text-text hover:bg-border/30 rounded select-none"
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenContextMenu(event, table);
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          onDoubleClick={() => void onOpenAction('selectTop100', table)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          {expanded ? (
            <ChevronDown size={14} className="shrink-0 text-muted" />
          ) : (
            <ChevronRight size={14} className="shrink-0 text-muted" />
          )}
          <Table2 size={14} className="h-[14px] w-[14px] shrink-0 text-blue-400" />
          <span className="text-sm truncate">{table}</span>
        </button>

        <button
          type="button"
          onClick={(event) => onOpenContextMenu(event, table)}
          className="mr-1 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-background/60 hover:text-text group-hover:opacity-100"
          title="Acoes da tabela"
        >
          <EllipsisVertical size={13} />
        </button>
      </div>

      {expanded ? (
        loading && !tableEntry?.columns?.length ? (
          <div className="ml-6 py-1">
            <LoaderCircle size={14} className="animate-spin text-muted" />
          </div>
        ) : tableEntry?.columnsError ? (
          <div className="ml-6 py-2 text-xs text-red-300">{tableEntry.columnsError}</div>
        ) : (
          <div className="ml-6 border-l border-border/50 pl-2">
            {tableEntry?.columns?.map((column) => (
              <div key={column.columnName} className="flex items-center gap-2 py-1 text-muted hover:text-text cursor-default">
                <Columns size={13} className="opacity-70" />
                <span className="text-sm truncate">{column.columnName}</span>
                <span className="text-xs text-muted/60 ml-auto">{column.dataType}</span>
              </div>
            ))}
          </div>
        )
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
      className="fixed inset-0 z-[140] flex items-center justify-center bg-background/72 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-lg border border-border bg-surface/95 shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
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

function ExplorerError({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-400/20 bg-red-400/8 p-3 text-sm text-red-300">{message}</div>;
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
  const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - 220));

  return { left, top };
}

function resolveMenuAnchor(event: ReactMouseEvent<HTMLElement>, menuWidth: number) {
  const currentTarget = event.currentTarget.getBoundingClientRect();
  const prefersRightSide = currentTarget.right + menuWidth + MENU_OFFSET_PX <= window.innerWidth - 8;
  const x = prefersRightSide
    ? Math.round(currentTarget.right + MENU_OFFSET_PX)
    : Math.round(Math.max(8, currentTarget.left - menuWidth - MENU_OFFSET_PX));
  const y = Math.round(Math.min(currentTarget.top, window.innerHeight - 220));

  return { x, y };
}
