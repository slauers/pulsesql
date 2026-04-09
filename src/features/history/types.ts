export type QueryHistoryStatus = 'success' | 'error' | 'cancelled';

export interface QueryHistoryItem {
  id: string;
  connectionId: string;
  connectionName: string;
  databaseName?: string;
  schemaName?: string;
  queryText: string;
  executedAt: string;
  durationMs?: number;
  status: QueryHistoryStatus;
  errorMessage?: string;
  rowCount?: number;
}

export interface QueryHistoryFilter {
  query?: string;
  connectionId?: string;
  status?: QueryHistoryStatus;
  limit?: number;
  offset?: number;
}
