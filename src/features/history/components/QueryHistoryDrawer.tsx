import { Clock3, RefreshCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { writeText as clipboardWriteText } from '@tauri-apps/plugin-clipboard-manager';
import { useQueryHistory } from '../hooks/useQueryHistory';
import type { QueryHistoryItem } from '../types';
import QueryHistoryFilters from './QueryHistoryFilters';
import QueryHistoryList from './QueryHistoryList';
import { translate, type AppLocale } from '../../../i18n';

export default function QueryHistoryDrawer({
  open,
  locale,
  activeConnectionId,
  activeConnectionName,
  refreshToken,
  onClose,
  onOpenInNewTab,
  onReplaceCurrent,
  onRunAgain,
}: {
  open: boolean;
  locale: AppLocale;
  activeConnectionId: string | null;
  activeConnectionName?: string | null;
  refreshToken?: number;
  onClose: () => void;
  onOpenInNewTab: (item: QueryHistoryItem) => void;
  onReplaceCurrent: (item: QueryHistoryItem) => void;
  onRunAgain: (item: QueryHistoryItem) => void;
}) {
  const { items, loading, error, filter, updateFilter, refresh, removeItem, clearAll, setStatus } =
    useQueryHistory(open, activeConnectionId);
  const [drawerWidth, setDrawerWidth] = useState(430);
  const [resizing, setResizing] = useState(false);

  const handleCopySql = async (item: QueryHistoryItem) => {
    await clipboardWriteText(item.queryText);
  };

  const handleDelete = async (item: QueryHistoryItem) => {
    await removeItem(item.id);
  };

  const handleClear = async () => {
    if (!window.confirm(translate(locale, 'clearHistoryConfirm'))) {
      return;
    }

    await clearAll();
  };

  useEffect(() => {
    if (!resizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = Math.min(Math.max(window.innerWidth - event.clientX, 320), 680);
      setDrawerWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setResizing(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [resizing]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refresh();
  }, [open, refreshToken, activeConnectionId]);

  return (
    <>
      {open ? <div className="absolute inset-0 z-20 bg-[#02050B]/60" onClick={onClose} /> : null}
      <aside
        className={`absolute right-0 top-0 z-30 h-full w-full max-w-[430px] border-l border-border/70 bg-surface/96 backdrop-blur-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ maxWidth: `${drawerWidth}px` }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize history panel"
          onPointerDown={() => setResizing(true)}
          className={`absolute left-0 top-0 h-full w-1 -translate-x-1/2 cursor-col-resize transition-colors ${
            resizing ? 'bg-primary/40' : 'hover:bg-primary/25'
          }`}
        />
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-4">
          <div className="flex items-center gap-2">
            <Clock3 size={16} className="text-primary" />
            <div>
              <div className="text-sm font-semibold text-text">{translate(locale, 'queryHistory')}</div>
              <div className="text-[11px] text-muted">
                {activeConnectionName ?? translate(locale, 'noActiveConnection')}
              </div>
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
          locale={locale}
          filter={filter}
          onQueryChange={(value) => updateFilter({ query: value })}
          onStatusChange={setStatus}
        />

        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="text-xs text-muted">{translate(locale, 'itemsCount', { count: items.length })}</div>
          <button onClick={() => void handleClear()} className="text-xs text-red-300 hover:underline">
            {translate(locale, 'clearHistory')}
          </button>
        </div>

        <div className="h-[calc(100%-180px)] overflow-auto">
          <QueryHistoryList
            locale={locale}
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
