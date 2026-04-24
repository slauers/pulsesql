import { useEffect, useRef } from 'react';

interface EcgMonitorProps {
  color: string;
  width?: number;
  height?: number;
  speed?: number;
  transparent?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function EcgMonitor({
  color, width = 280, height = 64, speed = 0.004,
  transparent = false, className, style,
}: EcgMonitorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Refs so the RAF loop reads current values without ever restarting
  const colorRef = useRef(color);
  const speedRef = useRef(speed);

  colorRef.current = color;
  speedRef.current = speed;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const W = canvas.width;
    const H = canvas.height;
    const CY = H / 2;
    const AMPLITUDE = H * 0.38;
    const TRAIL = W * 0.72;
    const history = new Array<number>(W).fill(CY);
    let rafId = 0;

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

    function hexAlpha(hex: string, a: number): string {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    }

    // Warm-up: pre-fill history so the trail is immediately visible
    const WARMUP_PHASE = 0.40;
    const startHead = Math.floor(TRAIL) + 2;
    for (let i = 0; i <= startHead; i++) {
      history[i] = CY - ecgSample(WARMUP_PHASE - (startHead - i) * speed) * AMPLITUDE;
    }
    let phase = WARMUP_PHASE;
    let headX = startHead;

    function draw() {
      const c = colorRef.current;
      const s = speedRef.current;

      phase += s;
      headX = (headX + 1) % W;
      history[headX] = CY - ecgSample(phase) * AMPLITUDE;

      if (transparent) {
        ctx.clearRect(0, 0, W, H);
      } else {
        ctx.fillStyle = '#010a0e';
        ctx.fillRect(0, 0, W, H);
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(0, CY); ctx.lineTo(W, CY); ctx.stroke();

      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (let i = 1; i <= Math.floor(TRAIL); i++) {
        const px = (headX - i + W) % W;
        const nx = (headX - i + 1 + W) % W;
        if (Math.abs(px - nx) > 1) continue; // skip wrap-boundary segment
        const fade = 1 - i / TRAIL;
        ctx.strokeStyle = hexAlpha(c, Math.min(fade * 1.2, 0.85));
        ctx.shadowColor  = hexAlpha(c, fade * 0.7);
        ctx.shadowBlur   = i < 8 ? 10 : i < 30 ? 5 : 0;
        ctx.beginPath();
        ctx.moveTo(px, history[px]);
        ctx.lineTo(nx, history[nx]);
        ctx.stroke();
      }

      ctx.shadowBlur  = 14;
      ctx.shadowColor = hexAlpha(c, 0.9);
      ctx.fillStyle   = c;
      ctx.beginPath();
      ctx.arc(headX, history[headX], 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(rafId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — intentional: loop runs once, reads via refs

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ display: 'block', borderRadius: 8, ...style }}
    />
  );
}
