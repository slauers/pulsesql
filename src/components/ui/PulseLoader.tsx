import EcgLine from './EcgLine';

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

const SIZE_CONFIG: Record<PulseLoaderSize, { line: 'sm' | 'md' | 'lg'; width: number; gap: string; text: string }> = {
  xs: { line: 'sm', width: 46, gap: 'gap-1', text: 'text-[9px]' },
  sm: { line: 'sm', width: 82, gap: 'gap-1.5', text: 'text-[10px]' },
  md: { line: 'md', width: 168, gap: 'gap-2', text: 'text-[10px]' },
  lg: { line: 'lg', width: 260, gap: 'gap-2.5', text: 'text-[11px]' },
};

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

  return (
    <div
      className={`inline-flex flex-col items-center justify-center ${config.gap} ${className}`}
      style={{
        minWidth: hasCard ? Math.max(config.width + 34, 132) : undefined,
        borderRadius: hasCard ? 14 : undefined,
        border: hasCard ? '1px solid var(--bt-border)' : undefined,
        background: hasCard ? 'var(--bt-surface)' : undefined,
        boxShadow: hasCard ? '0 18px 42px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255,255,255,0.035)' : undefined,
        padding: hasCard ? '16px 18px 14px' : undefined,
        ...style,
      }}
    >
      <EcgLine color={color} size={config.line} style={{ width: config.width }} />
      {message ? (
        <span
          className={`${config.text} font-medium uppercase leading-none`}
          style={{
            color,
            letterSpacing: '0.08em',
            opacity: 0.86,
          }}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
