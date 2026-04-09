import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import { clearQueryHistory, deleteQueryHistoryItem, listQueryHistory } from '../services/historyService';
import type { QueryHistoryFilter, QueryHistoryItem, QueryHistoryStatus } from '../types';

const DEFAULT_FILTER: QueryHistoryFilter = {
  query: '',
  connectionId: '',
  limit: 100,
  offset: 0,
};

export function useQueryHistory(open: boolean) {
  const [items, setItems] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueryHistoryFilter>(DEFAULT_FILTER);
  const deferredQuery = useDeferredValue(filter.query ?? '');

  const load = async (nextFilter: QueryHistoryFilter) => {
    setLoading(true);
    setError(null);

    try {
      const historyItems = await listQueryHistory({
        ...nextFilter,
        query: deferredQuery.trim() || undefined,
        connectionId: nextFilter.connectionId || undefined,
        status: nextFilter.status || undefined,
      });
      startTransition(() => {
        setItems(historyItems);
      });
    } catch (loadError) {
      setError(extractMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    void load(filter);
  }, [open, filter.connectionId, filter.status, filter.limit, filter.offset, deferredQuery]);

  const updateFilter = (partial: Partial<QueryHistoryFilter>) => {
    setFilter((current) => ({ ...current, ...partial, offset: 0 }));
  };

  const refresh = async () => {
    await load(filter);
  };

  const removeItem = async (id: string) => {
    await deleteQueryHistoryItem(id);
    await refresh();
  };

  const clearAll = async () => {
    await clearQueryHistory();
    await refresh();
  };

  return {
    items,
    loading,
    error,
    filter,
    refresh,
    updateFilter,
    removeItem,
    clearAll,
    setStatus: (status: QueryHistoryStatus | '') => updateFilter({ status: status || undefined }),
  };
}

function extractMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Falha ao carregar o historico de queries.';
}
