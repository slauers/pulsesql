import type { DatabaseEngine } from '../../store/connections';
import type { MetadataColumn } from './types';

export type ExplorerActionId = 'selectTop100' | 'countRows' | 'describeTable' | 'update' | 'insert';

export interface TableReference {
  schema?: string | null;
  table: string;
}

export function buildSelectTopQuery(engine: DatabaseEngine, reference: TableReference): string {
  const tableName = formatTableReference(reference);

  if (engine === 'oracle') {
    return `SELECT *
FROM ${tableName}
FETCH FIRST 100 ROWS ONLY;`;
  }

  return `SELECT *
FROM ${tableName}
LIMIT 100;`;
}

export function buildCountRowsQuery(reference: TableReference): string {
  return `SELECT COUNT(*)
FROM ${formatTableReference(reference)};`;
}

export function buildInsertTemplate(
  engine: DatabaseEngine,
  reference: TableReference,
  columns?: MetadataColumn[],
): string {
  const selectedColumns = takeInsertColumns(columns);
  const values = selectedColumns.map((column) => buildInsertValuePlaceholder(engine, column));

  return `INSERT INTO ${formatTableReference(reference)} (
  ${selectedColumns.map((column) => column.columnName).join(',\n  ')}
) VALUES (
  ${values.join(',\n  ')}
);`;
}

export function buildUpdateTemplate(reference: TableReference): string {
  return `UPDATE ${formatTableReference(reference)}
SET ? = ?
WHERE id = ?;`;
}

export function formatTableReference(reference: TableReference): string {
  return reference.schema ? `${reference.schema}.${reference.table}` : reference.table;
}

function takeInsertColumns(columns?: MetadataColumn[]): MetadataColumn[] {
  const filteredColumns = columns?.filter((column) => !isPrimaryIdColumn(column.columnName)) ?? [];

  if (filteredColumns.length) {
    return filteredColumns;
  }

  return [
    createFallbackColumn('column1'),
    createFallbackColumn('column2'),
  ];
}

function buildInsertValuePlaceholder(engine: DatabaseEngine, column: MetadataColumn): string {
  const dataType = column.dataType.toLowerCase();

  if (isDateLikeType(dataType)) {
    return engine === 'oracle' ? 'SYSDATE' : 'NOW()';
  }

  if (isNumericType(dataType)) {
    return '0';
  }

  if (isBooleanType(dataType)) {
    return engine === 'oracle' ? '0' : 'false';
  }

  return "''";
}

function isPrimaryIdColumn(columnName: string): boolean {
  return columnName.trim().toLowerCase() === 'id';
}

function createFallbackColumn(columnName: string): MetadataColumn {
  return {
    columnName,
    dataType: 'varchar',
    nullable: null,
    defaultValue: null,
    isAutoIncrement: null,
  };
}

function isDateLikeType(dataType: string): boolean {
  return (
    dataType.includes('date') ||
    dataType.includes('time') ||
    dataType.includes('timestamp')
  );
}

function isNumericType(dataType: string): boolean {
  return (
    dataType.includes('int') ||
    dataType.includes('number') ||
    dataType.includes('numeric') ||
    dataType.includes('decimal') ||
    dataType.includes('float') ||
    dataType.includes('double') ||
    dataType.includes('real') ||
    dataType.includes('serial')
  );
}

function isBooleanType(dataType: string): boolean {
  return dataType.includes('bool') || dataType === 'bit';
}
