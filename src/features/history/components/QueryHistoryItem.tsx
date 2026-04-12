import type { ReactNode } from 'react';
import { Copy, FilePlus2, Play, Replace, Trash2 } from 'lucide-react';
import type { QueryHistoryItem as QueryHistoryItemType } from '../types';
import { formatDateTime, translate, type AppLocale } from '../../../i18n';

export default function QueryHistoryItem({
  locale,
  item,
  onOpenInNewTab,
  onReplaceCurrent,
  onCopySql,
  onRunAgain,
  onDelete,
}: {
  locale: AppLocale;
  item: QueryHistoryItemType;
  onOpenInNewTab: () => void;
  onReplaceCurrent: () => void;
  onCopySql: () => void;
  onRunAgain: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/35 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-text">{item.connectionName}</div>
          <div className="mt-1 text-[11px] text-muted">
            {formatStatus(locale, item.status)} - {formatDateTime(locale, item.executedAt)}
            {typeof item.durationMs === 'number' ? ` - ${item.durationMs}ms` : ''}
            {typeof item.rowCount === 'number' ? ` - ${translate(locale, 'rowsCount', { count: item.rowCount })}` : ''}
          </div>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${statusTone(item.status)}`}>
          {item.status}
        </span>
      </div>

      <pre className="max-h-36 overflow-auto rounded-xl bg-[#08111D] px-3 py-2 text-xs text-slate-200 whitespace-pre-wrap break-words">
        {item.queryText}
      </pre>

      {item.errorMessage ? (
        <div className="mt-2 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-300">
          {item.errorMessage}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <HistoryAction label={translate(locale, 'openInNewTab')} icon={<FilePlus2 size={12} />} onClick={onOpenInNewTab} />
        <HistoryAction label={translate(locale, 'replaceCurrent')} icon={<Replace size={12} />} onClick={onReplaceCurrent} />
        <HistoryAction label={translate(locale, 'copySql')} icon={<Copy size={12} />} onClick={onCopySql} />
        <HistoryAction label={translate(locale, 'runAgain')} icon={<Play size={12} />} onClick={onRunAgain} />
        <HistoryAction label={translate(locale, 'remove')} icon={<Trash2 size={12} />} onClick={onDelete} danger />
      </div>
    </div>
  );
}

function HistoryAction({
  label,
  icon,
  onClick,
  danger = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${
        danger
          ? 'border-red-500/20 text-red-300 hover:bg-red-500/10'
          : 'border-border text-muted hover:bg-border/30 hover:text-text'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function formatStatus(locale: AppLocale, status: QueryHistoryItemType['status']) {
  if (status === 'success') {
    return translate(locale, 'success');
  }

  if (status === 'error') {
    return translate(locale, 'error');
  }

  return translate(locale, 'cancelled');
}

function statusTone(status: QueryHistoryItemType['status']) {
  if (status === 'success') {
    return 'bg-emerald-400/10 text-emerald-300';
  }

  if (status === 'error') {
    return 'bg-red-400/10 text-red-300';
  }

  return 'bg-amber-400/10 text-amber-300';
}
