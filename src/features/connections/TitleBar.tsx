import { hexToRgba } from '../../store/connections';

interface TitleBarProps {
  connectionColor: string;
  connectionName: string | null;
  schema: string | null;
  isConnected: boolean;
}

function PulseSQLMark({ size, color }: { size: number; color: string }) {
  const h = size * (80 / 120);
  return (
    <svg width={size} height={h} viewBox="0 0 120 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10 40 L30 40 L40 20 L55 60 L70 30 L85 40 L110 40"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TitleBar({ connectionColor, connectionName, schema, isConnected }: TitleBarProps) {
  return (
    <div
      className="relative z-10 flex shrink-0 items-center border-b border-border"
      style={{ height: 38, padding: '0 14px', gap: 0 }}
      data-tauri-drag-region
    >
      <PulseSQLMark size={18} color={connectionColor} />
      <span
        className="font-bold text-text"
        style={{ marginLeft: 8, fontSize: 13, letterSpacing: 0.2 }}
      >
        PulseSQL
      </span>

      {connectionName ? (
        <div style={{ marginLeft: 14, display: 'flex', alignItems: 'center', gap: 0, fontSize: 12 }}>
          {/* Connection name pill */}
          <div
            style={{
              padding: '4px 10px',
              borderRadius: '6px 0 0 6px',
              background: hexToRgba(connectionColor, 0.045),
              border: `1px solid ${hexToRgba(connectionColor, 0.16)}`,
              borderRight: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                flexShrink: 0,
                background: connectionColor,
                opacity: 0.7,
              }}
            />
            <span style={{ color: 'var(--bt-text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              {connectionName}
            </span>
          </div>
          {/* Schema pill */}
          <div
            style={{
              padding: '4px 10px',
              borderRadius: '0 6px 6px 0',
              background: 'var(--bt-surface)',
              border: '1px solid var(--bt-border)',
              color: 'var(--bt-muted)',
              fontSize: 11.5,
              whiteSpace: 'nowrap',
            }}
          >
            {schema ?? 'public'}{' '}
            <span style={{ color: 'var(--bt-muted)', fontSize: 10, opacity: 0.7 }}>▾</span>
          </div>
        </div>
      ) : null}

      {isConnected ? (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
          <span
            style={{
              fontSize: 10,
              letterSpacing: 1,
              fontWeight: 600,
              color: 'var(--bt-muted)',
              padding: '3px 9px',
              borderRadius: 999,
              border: `1px solid ${hexToRgba(connectionColor, 0.12)}`,
              background: hexToRgba(connectionColor, 0.035),
              whiteSpace: 'nowrap',
            }}
          >
            ● LIVE
          </span>
        </div>
      ) : (
        <div style={{ marginLeft: 'auto' }} />
      )}
    </div>
  );
}
