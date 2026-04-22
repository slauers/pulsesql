import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowUpCircle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';

export interface UpdateInfo {
  version: string;
  body: string | null;
}

interface UpdateProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
}

type InstallState = 'idle' | 'downloading' | 'installing';

export function UpdateButton({ update }: { update: UpdateInfo }) {
  const [open, setOpen] = useState(false);
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const button = buttonRef.current;
    if (button) {
      const rect = button.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleInstall = async () => {
    setInstallState('downloading');
    setProgress(null);
    setError(null);

    unlistenRef.current?.();
    unlistenRef.current = await listen<UpdateProgress>('update-progress', (event) => {
      setProgress(event.payload);
      setInstallState('downloading');
    });

    try {
      await invoke('install_update');
      // app.restart() is called on the Rust side — execution stops here on most platforms.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInstallState('idle');
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  };

  const progressPercent = progress?.percent ?? null;
  const progressLabel = progress
    ? progressPercent !== null
      ? `${progressPercent}%`
      : `${formatBytes(progress.downloaded)} downloaded`
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-6 items-center gap-1.5 px-2 text-[11px] transition-colors ${
          open
            ? 'bg-primary/20 text-primary'
            : 'text-primary/80 hover:bg-primary/15 hover:text-primary'
        }`}
        title={`PulseSQL ${update.version} available`}
      >
        <ArrowUpCircle size={12} />
        <span>{update.version}</span>
      </button>

      {open && dropdownPos
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[200] w-[280px] overflow-hidden rounded-xl border border-border/80 bg-surface/98 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm"
              style={{ top: dropdownPos.top, right: dropdownPos.right }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-4 pt-4 pb-3">
                <div className="text-[13px] font-semibold text-text">
                  PulseSQL {update.version}
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  A new version is ready to install.
                </div>
                {update.body ? (
                  <div
                    className="mt-3 text-[11px] leading-relaxed text-muted/80 prose-sm max-h-48 overflow-y-auto [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:space-y-0.5 [&_h3]:font-semibold [&_h3]:text-text [&_h3]:mt-2 [&_h3]:mb-1"
                    dangerouslySetInnerHTML={{ __html: marked.parse(update.body) as string }}
                  />
                ) : null}
              </div>

              {installState === 'downloading' ? (
                <div className="mx-4 mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-muted">Downloading…</span>
                    {progressLabel ? (
                      <span className="text-[11px] text-primary/80">{progressLabel}</span>
                    ) : null}
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-border/50">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: progressPercent !== null ? `${progressPercent}%` : '100%' }}
                    />
                  </div>
                  {progressPercent === null ? (
                    <div className="h-1 w-full overflow-hidden rounded-full bg-border/50 -mt-1">
                      <div className="h-full w-1/3 rounded-full bg-primary/60 animate-[slide_1.4s_ease-in-out_infinite]" />
                    </div>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <div className="mx-4 mb-3 rounded-lg border border-border/60 bg-background/24 px-3 py-2 text-[11px] text-muted">
                  {error}
                </div>
              ) : null}

              <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3">
                <button
                  type="button"
                  onClick={() => void handleInstall()}
                  disabled={installState !== 'idle'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/90 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {installState !== 'idle' ? (
                    <>
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      {installState === 'downloading' ? 'Downloading…' : 'Installing…'}
                    </>
                  ) : (
                    'Install & Restart'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={installState !== 'idle'}
                  className="px-3 py-1.5 text-[12px] text-muted hover:text-text disabled:opacity-40"
                >
                  Later
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
