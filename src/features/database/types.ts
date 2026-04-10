import type { DatabaseEngine } from '../../store/connections';

export interface ColumnDef {
  column_name: string;
  data_type: string;
  nullable?: boolean | null;
  default_value?: string | null;
}

export interface MetadataColumn {
  columnName: string;
  dataType: string;
  nullable: boolean | null;
  defaultValue: string | null;
}

export interface MetadataTableEntry {
  name: string;
  columns?: MetadataColumn[];
  columnsLoadedAt?: number;
  columnsError?: string | null;
}

export interface MetadataSchemaEntry {
  name: string;
  tables: string[];
  tablesLoadedAt?: number;
  tablesError?: string | null;
  tablesByName: Record<string, MetadataTableEntry>;
}

export interface MetadataConnectionEntry {
  connectionId: string;
  engine: DatabaseEngine;
  schemas: string[];
  schemasLoadedAt?: number;
  schemasError?: string | null;
  schemasByName: Record<string, MetadataSchemaEntry>;
}

export function normalizeColumnDef(column: ColumnDef): MetadataColumn {
  return {
    columnName: column.column_name,
    dataType: column.data_type,
    nullable: typeof column.nullable === 'boolean' ? column.nullable : null,
    defaultValue: typeof column.default_value === 'string' ? column.default_value.trim() || null : null,
  };
}
