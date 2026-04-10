import type { ConnectionConfig } from '../../../store/connections';
import type { QueryHistoryFilter, QueryHistoryStatus } from '../types';
import AppSelect from '../../../components/ui/AppSelect';

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
        <AppSelect
          value={filter.connectionId ?? ''}
          onChange={onConnectionChange}
          options={[
            { value: '', label: 'Todas conexoes' },
            ...connections.map((connection) => ({
              value: connection.id,
              label: connection.name,
            })),
          ]}
          className="bg-background/50"
        />

        <AppSelect
          value={filter.status ?? ''}
          onChange={(value) => onStatusChange(value as QueryHistoryStatus | '')}
          options={[
            { value: '', label: 'Todos status' },
            { value: 'success', label: 'Success' },
            { value: 'error', label: 'Error' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
          className="bg-background/50"
        />
      </div>
    </div>
  );
}
