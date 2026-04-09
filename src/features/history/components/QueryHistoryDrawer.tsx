import { Clock3, RefreshCcw, X } from 'lucide-react';
import type { ConnectionConfig } from '../../../store/connections';
import { useQueryHistory } from '../hooks/useQueryHistory';
import type { QueryHistoryItem } from '../types';
import QueryHistoryFilters from './QueryHistoryFilters';
import QueryHistoryList from './QueryHistoryList';

export default function QueryHistoryDrawer({
  open,
  connections,
  onClose,
  onOpenInNewTab,
  onReplaceCurrent,
  onRunAgain,
}: {
  open: boolean;
  connections: ConnectionConfig[];
  onClose: () => void;
  onOpenInNewTab: (item: QueryHistoryItem) => void;
  onReplaceCurrent: (item: QueryHistoryItem) => void;
  onRunAgain: (item: QueryHistoryItem) => void;
}) {
  const { items, loading, error, filter, updateFilter, refresh, removeItem, clearAll, setStatus } =
    useQueryHistory(open);

  const handleCopySql = async (item: QueryHistoryItem) => {
    await navigator.clipboard.writeText(item.queryText);
  };

  const handleDelete = async (item: QueryHistoryItem) => {
    await removeItem(item.id);
  };

  const handleClear = async () => {
    if (!window.confirm('Limpar todo o historico de queries?')) {
      return;
    }

    await clearAll();
  };

  return (
    <>
      {open ? <div className="absolute inset-0 z-20 bg-[#02050B]/60" onClick={onClose} /> : null}
      <aside
        className={`absolute right-0 top-0 z-30 h-full w-full max-w-[430px] border-l border-border/70 bg-surface/96 backdrop-blur-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-4">
          <div className="flex items-center gap-2">
            <Clock3 size={16} className="text-primary" />
            <div>
              <div className="text-sm font-semibold text-text">Query History</div>
              <div className="text-[11px] text-muted">Execucoes manuais mais recentes</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => void refresh()} className="rounded-lg border border-border p-2 text-muted hover:bg-border/30 hover:text-text">
              <RefreshCcw size={14} />
            </button>
            <button onClick={onClose} className="rounded-lg border border-border p-2 text-muted hover:bg-border/30 hover:text-text">
              <X size={14} />
            </button>
          </div>
        </div>

        <QueryHistoryFilters
          filter={filter}
          connections={connections}
          onQueryChange={(value) => updateFilter({ query: value })}
          onConnectionChange={(value) => updateFilter({ connectionId: value || undefined })}
          onStatusChange={setStatus}
        />

        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="text-xs text-muted">{items.length} item(ns)</div>
          <button onClick={() => void handleClear()} className="text-xs text-red-300 hover:underline">
            Limpar historico
          </button>
        </div>

        <div className="h-[calc(100%-180px)] overflow-auto">
          <QueryHistoryList
            items={items}
            loading={loading}
            error={error}
            onOpenInNewTab={onOpenInNewTab}
            onReplaceCurrent={onReplaceCurrent}
            onCopySql={(item) => void handleCopySql(item)}
            onRunAgain={onRunAgain}
            onDelete={(item) => void handleDelete(item)}
          />
        </div>
      </aside>
    </>
  );
}
