import type React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
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
    <svg
      width={size}
      height={h}
      viewBox="0 0 120 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-tauri-drag-region
    >
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
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      e.preventDefault();
      void getCurrentWindow().startDragging();
    }
  };

  return (
    <div
      className="relative z-10 flex shrink-0 items-center border-b"
      style={{
        height: 40,
        padding: '0 14px 0 78px',
        gap: 0,
        backgroundColor: 'rgb(var(--bt-background-rgb) / 0.90)',
        backgroundImage: `linear-gradient(to right, ${hexToRgba(connectionColor, 0.22)} 0%, ${hexToRgba(connectionColor, 0.07)} 36%, transparent 62%)`,
        borderBottomColor: hexToRgba(connectionColor, 0.24),
        backdropFilter: 'blur(18px)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
    >
      <div
        data-tauri-drag-region
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}
      >
        <PulseSQLMark size={18} color={connectionColor} />
        <span
          className="font-bold text-text"
          style={{ fontSize: 13, letterSpacing: 0.2 }}
          data-tauri-drag-region
        >
          PulseSQL
        </span>
      </div>

      {connectionName ? (
        <div
          data-tauri-drag-region
          style={{ marginLeft: 14, display: 'flex', alignItems: 'center', gap: 0, fontSize: 12 }}
        >
          {/* Connection name pill */}
          <div
            data-tauri-drag-region
            style={{
              padding: '4px 10px',
              borderRadius: '6px 0 0 6px',
              background: hexToRgba(connectionColor, 0.045),
              border: `1px solid ${hexToRgba(connectionColor, 0.20)}`,
              borderRight: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              data-tauri-drag-region
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                flexShrink: 0,
                background: connectionColor,
                opacity: 0.8,
              }}
            />
            <span
              data-tauri-drag-region
              style={{ color: 'var(--bt-text)', fontWeight: 600, whiteSpace: 'nowrap' }}
            >
              {connectionName}
            </span>
          </div>
          {/* Schema pill */}
          <div
            data-tauri-drag-region
            style={{
              padding: '4px 10px',
              borderRadius: '0 6px 6px 0',
              background: hexToRgba(connectionColor, 0.025),
              border: `1px solid ${hexToRgba(connectionColor, 0.14)}`,
              color: 'var(--bt-muted)',
              fontSize: 11.5,
              whiteSpace: 'nowrap',
            }}
          >
            <span data-tauri-drag-region>{schema ?? 'public'}</span>{' '}
            <span data-tauri-drag-region style={{ color: 'var(--bt-muted)', fontSize: 10, opacity: 0.7 }}>▾</span>
          </div>
        </div>
      ) : null}

      {isConnected ? (
        <div
          data-tauri-drag-region
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}
        >
          <span
            data-tauri-drag-region
            style={{
              fontSize: 10,
              letterSpacing: 1,
              fontWeight: 600,
              color: hexToRgba(connectionColor, 0.9),
              padding: '3px 9px',
              borderRadius: 999,
              border: `1px solid ${hexToRgba(connectionColor, 0.22)}`,
              background: hexToRgba(connectionColor, 0.08),
              whiteSpace: 'nowrap',
            }}
          >
            ● LIVE
          </span>
        </div>
      ) : (
        <div data-tauri-drag-region style={{ marginLeft: 'auto' }} />
      )}
    </div>
  );
}
