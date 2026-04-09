import type { QueryHistoryItem } from '../types';
import QueryHistoryItemCard from './QueryHistoryItem';

export default function QueryHistoryList({
  items,
  loading,
  error,
  onOpenInNewTab,
  onReplaceCurrent,
  onCopySql,
  onRunAgain,
  onDelete,
}: {
  items: QueryHistoryItem[];
  loading: boolean;
  error: string | null;
  onOpenInNewTab: (item: QueryHistoryItem) => void;
  onReplaceCurrent: (item: QueryHistoryItem) => void;
  onCopySql: (item: QueryHistoryItem) => void;
  onRunAgain: (item: QueryHistoryItem) => void;
  onDelete: (item: QueryHistoryItem) => void;
}) {
  if (loading) {
    return <div className="px-4 py-6 text-sm text-muted">Carregando historico...</div>;
  }

  if (error) {
    return <div className="px-4 py-6 text-sm text-red-300">{error}</div>;
  }

  if (!items.length) {
    return <div className="px-4 py-6 text-sm text-muted">Nenhuma execucao encontrada.</div>;
  }

  return (
    <div className="space-y-3 px-4 py-4">
      {items.map((item) => (
        <QueryHistoryItemCard
          key={item.id}
          item={item}
          onOpenInNewTab={() => onOpenInNewTab(item)}
          onReplaceCurrent={() => onReplaceCurrent(item)}
          onCopySql={() => onCopySql(item)}
          onRunAgain={() => onRunAgain(item)}
          onDelete={() => onDelete(item)}
        />
      ))}
    </div>
  );
}
