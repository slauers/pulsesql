type PulseLoaderSize = 'xs' | 'sm' | 'md' | 'lg';
type PulseLoaderSurface = 'transparent' | 'card';

interface PulseLoaderProps {
  color?: string;
  message?: string | null;
  size?: PulseLoaderSize;
  surface?: PulseLoaderSurface;
  className?: string;
  style?: React.CSSProperties;
}

const SIZE_CONFIG: Record<PulseLoaderSize, { mark: number; gap: string; text: string; padding: string }> = {
  xs: { mark: 14, gap: 'gap-1', text: 'text-[9px]', padding: '0' },
  sm: { mark: 28, gap: 'gap-1.5', text: 'text-[10px]', padding: '10px 12px' },
  md: { mark: 42, gap: 'gap-2', text: 'text-[11px]', padding: '14px 16px 13px' },
  lg: { mark: 130, gap: 'gap-2.5', text: 'text-[12px]', padding: '16px 18px 15px' },
};

function PulseMark({ size, color, double = false }: { size: number; color: string; double?: boolean }) {
  const isTiny = size <= 16;
  const viewBox = double ? '0 0 230 80' : '0 0 120 80';
  const path = double
    ? 'M10 40 L30 40 L40 20 L55 60 L70 30 L85 40 L110 40 H138 L148 20 L163 60 L178 30 L193 40 L220 40'
    : 'M10 40 L30 40 L40 20 L55 60 L70 30 L85 40 L110 40';
  const aspectRatio = double ? 80 / 230 : 80 / 120;

  return (
    <span
      className={`pulse-loader-mark${isTiny ? ' pulse-loader-mark--tiny' : ''}`}
      style={{
        width: size,
        height: Math.max(10, Math.round(size * aspectRatio)),
        flexBasis: size,
        '--pulse-loader-color': color,
      } as React.CSSProperties}
    >
      <svg viewBox={viewBox} fill="none" aria-hidden="true">
        <path
          className="pulse-loader-mark-path pulse-loader-mark-path--base"
          pathLength="100"
          d={path}
        />
        <path
          className="pulse-loader-mark-path pulse-loader-mark-path--trace"
          pathLength="100"
          d={path}
        />
      </svg>
    </span>
  );
}

export default function PulseLoader({
  color = 'var(--bt-primary)',
  message,
  size = 'md',
  surface = 'transparent',
  className = '',
  style,
}: PulseLoaderProps) {
  const config = SIZE_CONFIG[size];
  const hasCard = surface === 'card';

  if (size === 'xs') {
    return (
      <span
        className={`inline-flex items-center justify-center ${className}`}
        style={{
          ...style,
        }}
        aria-label={message ?? 'Carregando'}
      >
        <PulseMark size={config.mark} color={color} />
      </span>
    );
  }

  return (
    <div
      className={`inline-flex flex-col items-center justify-center ${config.gap} ${className}`}
      style={{
        minWidth: hasCard ? Math.max(config.mark + 96, 148) : undefined,
        borderRadius: hasCard ? 10 : undefined,
        border: hasCard ? '1px solid rgba(var(--bt-border-rgb), 0.9)' : undefined,
        background: hasCard ? 'color-mix(in srgb, var(--bt-surface) 86%, var(--bt-background))' : undefined,
        boxShadow: hasCard ? '0 16px 34px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255,255,255,0.025)' : undefined,
        padding: hasCard ? config.padding : undefined,
        ...style,
      }}
    >
      <PulseMark size={config.mark} color={color} double={size === 'lg'} />
      {message ? (
        <span
          className={`${config.text} font-medium leading-none`}
          style={{
            color: 'var(--bt-muted)',
            letterSpacing: '0.02em',
          }}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
