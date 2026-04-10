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

export function buildInsertTemplate(reference: TableReference, columns?: MetadataColumn[]): string {
  const selectedColumns = takeTemplateColumns(columns, ['column1', 'column2']);
  const values = selectedColumns.map((_, index) => `value${index + 1}`);

  return `INSERT INTO ${formatTableReference(reference)} (
  ${selectedColumns.join(',\n  ')}
) VALUES (
  ${values.join(',\n  ')}
);`;
}

export function buildUpdateTemplate(reference: TableReference, columns?: MetadataColumn[]): string {
  const selectedColumns = takeTemplateColumns(columns, ['column1', 'column2']);
  const assignments = selectedColumns.map((column, index) =>
    index === 0 ? `${column} = value1` : `    ${column} = value${index + 1}`,
  );

  return `UPDATE ${formatTableReference(reference)}
SET ${assignments.join(',\n')}
WHERE condition;`;
}

export function formatTableReference(reference: TableReference): string {
  return reference.schema ? `${reference.schema}.${reference.table}` : reference.table;
}

function takeTemplateColumns(columns: MetadataColumn[] | undefined, fallback: string[]): string[] {
  if (!columns?.length) {
    return fallback;
  }

  return columns.slice(0, 2).map((column) => column.columnName);
}
