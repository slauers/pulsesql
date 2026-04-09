import { invoke } from '@tauri-apps/api/core';
import type { QueryHistoryFilter, QueryHistoryItem } from '../types';

export async function listQueryHistory(filter: QueryHistoryFilter): Promise<QueryHistoryItem[]> {
  return invoke<QueryHistoryItem[]>('list_query_history', { filter });
}

export async function deleteQueryHistoryItem(id: string): Promise<void> {
  await invoke('delete_query_history_item', { id });
}

export async function clearQueryHistory(): Promise<void> {
  await invoke('clear_query_history');
}
