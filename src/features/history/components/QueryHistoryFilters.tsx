import type { ConnectionConfig } from '../../../store/connections';
import type { QueryHistoryFilter, QueryHistoryStatus } from '../types';

export default function QueryHistoryFilters({
  filter,
  connections,
  onQueryChange,
  onConnectionChange,
  onStatusChange,
}: {
  filter: QueryHistoryFilter;
  connections: ConnectionConfig[];
  onQueryChange: (value: string) => void;
  onConnectionChange: (value: string) => void;
  onStatusChange: (value: QueryHistoryStatus | '') => void;
}) {
  return (
    <div className="space-y-3 border-b border-border/70 px-4 py-4">
      <input
        value={filter.query ?? ''}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Buscar por texto SQL"
        className="w-full rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-primary"
      />

      <div className="grid grid-cols-2 gap-3">
        <select
          value={filter.connectionId ?? ''}
          onChange={(event) => onConnectionChange(event.target.value)}
          className="rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-primary"
        >
          <option value="">Todas conexoes</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>

        <select
          value={filter.status ?? ''}
          onChange={(event) => onStatusChange(event.target.value as QueryHistoryStatus | '')}
          className="rounded-xl border border-border bg-background/50 px-3 py-2 text-sm text-text outline-none transition-colors focus:border-primary"
        >
          <option value="">Todos status</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
    </div>
  );
}
