import { useId } from 'react';

function ecgSample(t: number): number {
  const p = ((t % 1) + 1) % 1;
  if (p < 0.30) return 0;
  if (p < 0.38) return Math.sin((p - 0.30) / 0.08 * Math.PI) * 0.18;
  if (p < 0.42) return 0;
  if (p < 0.445) return -Math.sin((p - 0.42)  / 0.025 * Math.PI) * 0.18;
  if (p < 0.465) return  Math.sin((p - 0.445) / 0.020 * Math.PI) * 0.92;
  if (p < 0.490) return -Math.sin((p - 0.465) / 0.025 * Math.PI) * 0.32;
  if (p < 0.52)  return 0;
  if (p < 0.65)  return  Math.sin((p - 0.52)  / 0.13  * Math.PI) * 0.32;
  return 0;
}

// One ECG cycle = 120px. Build N cycles of path data once at module load.
const CYCLE_W = 120;
const CYCLE_COUNT = 5;

function buildPath(h: number): string {
  const cy = h / 2;
  const amp = h * 0.38;
  const steps = 80;
  const parts: string[] = [];
  for (let c = 0; c < CYCLE_COUNT; c++) {
    for (let s = 0; s <= steps; s++) {
      const p = s / steps;
      const x = (c + p) * CYCLE_W;
      const y = cy - ecgSample(p) * amp;
      parts.push(`${c === 0 && s === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
  return parts.join(' ');
}

const SIZES = {
  sm: { w: 80,  h: 20 },
  md: { w: 160, h: 28 },
  lg: { w: 280, h: 36 },
} as const;

// Pre-computed at module load — no per-render work
const PATHS: Record<keyof typeof SIZES, string> = {
  sm: buildPath(SIZES.sm.h),
  md: buildPath(SIZES.md.h),
  lg: buildPath(SIZES.lg.h),
};

interface EcgLineProps {
  color: string;
  size?: keyof typeof SIZES;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * CSS-animated ECG loader. The animation runs on a plain HTML <div> with
 * will-change:transform so it stays on the GPU compositor thread and never
 * freezes even when the JS thread is busy processing a large result set.
 *
 * Requires @keyframes ecg-line-scroll in index.css (translateX 0 → -120px).
 */
export default function EcgLine({ color, size = 'md', className, style }: EcgLineProps) {
  const id = useId().replace(/:/g, '');
  const { w, h } = SIZES[size];
  const totalW = CYCLE_W * CYCLE_COUNT;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: w,
        height: h,
        overflow: 'hidden',
        // Fade: transparent on the left, full opacity on the right
        WebkitMaskImage:
          'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.55) 28%, rgba(0,0,0,0.9) 65%, black 100%)',
        maskImage:
          'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.55) 28%, rgba(0,0,0,0.9) 65%, black 100%)',
        ...style,
      }}
    >
      {/* Animation on an HTML div — guaranteed GPU compositor layer */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          willChange: 'transform',
          animation: 'ecg-line-scroll 1.4s linear infinite',
        }}
      >
        <svg width={totalW} height={h} style={{ display: 'block' }}>
          <defs>
            <filter id={`ef${id}`} x="-5%" y="-60%" width="110%" height="220%">
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d={PATHS[size]}
            stroke={color}
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#ef${id})`}
          />
        </svg>
      </div>
    </div>
  );
}
