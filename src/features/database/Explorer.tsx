import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronRight, ChevronDown, Database, LayoutTemplate, Table2, Columns, LoaderCircle } from 'lucide-react';

interface ColumnDef {
  column_name: string;
  data_type: string;
}

export function ColumnItem({ schema, table, connId }: { schema: string; table: string; connId: string }) {
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<ColumnDef[]>('list_columns', { connId, schema, table }).then(cols => {
      setColumns(cols);
      setLoading(false);
    }).catch(console.error);
  }, [connId, schema, table]);

  if (loading) return <div className="ml-6 py-1"><LoaderCircle size={14} className="animate-spin text-muted" /></div>;

  return (
    <div className="ml-6 border-l border-border/50 pl-2">
      {columns.map(col => (
        <div key={col.column_name} className="flex items-center gap-2 py-1 text-muted hover:text-text cursor-default">
          <Columns size={13} className="opacity-70" />
          <span className="text-sm truncate">{col.column_name}</span>
          <span className="text-xs text-muted/60 ml-auto">{col.data_type}</span>
        </div>
      ))}
    </div>
  );
}

export function TableItem({ schema, connId }: { schema: string; connId: string }) {
  const [tables, setTables] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    invoke<string[]>('list_tables', { connId, schema }).then(tt => {
      setTables(tt);
      setLoading(false);
    }).catch(console.error);
  }, [connId, schema]);

  if (loading) return <div className="ml-6 py-1"><LoaderCircle size={14} className="animate-spin text-muted" /></div>;

  return (
    <div className="ml-5 border-l border-border/50 pl-2">
      {tables.map(table => (
        <div key={table}>
          <div 
            onClick={() => setExpanded(p => ({ ...p, [table]: !p[table] }))}
            className="flex items-center gap-1.5 py-1 text-text hover:bg-border/30 rounded cursor-pointer select-none"
          >
            {expanded[table] ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
            <Table2 size={14} className="text-blue-400" />
            <span className="text-sm">{table}</span>
          </div>
          {expanded[table] && <ColumnItem connId={connId} schema={schema} table={table} />}
        </div>
      ))}
    </div>
  );
}

export function SchemaTree({ connId }: { connId: string }) {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 'public': true });

  useEffect(() => {
    invoke<string[]>('list_schemas', { connId }).then(s => {
      setSchemas(s);
      setLoading(false);
    }).catch(console.error);
  }, [connId]);

  if (loading) return <div className="flex justify-center p-4"><LoaderCircle size={18} className="animate-spin text-muted" /></div>;

  return (
    <div className="mt-2">
      {schemas.map(schema => (
        <div key={schema}>
          <div 
            onClick={() => setExpanded(p => ({ ...p, [schema]: !p[schema] }))}
            className="flex items-center gap-1.5 py-1.5 px-2 text-text hover:bg-border/30 rounded cursor-pointer select-none"
          >
            {expanded[schema] ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
            <LayoutTemplate size={15} className="text-amber-400" />
            <span className="text-sm font-medium">{schema}</span>
          </div>
          {expanded[schema] && <TableItem connId={connId} schema={schema} />}
        </div>
      ))}
    </div>
  );
}

export function DatabaseExplorer({ connId, dbName }: { connId: string, dbName: string }) {
  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="p-3 border-b border-border bg-background/50 flex items-center gap-2">
        <Database size={16} className="text-primary" />
        <span className="font-semibold text-sm truncate">{dbName}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <SchemaTree connId={connId} />
      </div>
    </div>
  );
}
