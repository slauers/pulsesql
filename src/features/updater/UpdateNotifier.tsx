import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowUpCircle } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface UpdateInfo {
  version: string;
  body: string | null;
}

type InstallState = 'idle' | 'installing';

export function UpdateButton({ update }: { update: UpdateInfo }) {
  const [open, setOpen] = useState(false);
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null);

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
    setInstallState('installing');
    setError(null);
    try {
      await invoke('install_update');
      // app.restart() is called on the Rust side — execution stops here on most platforms.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInstallState('idle');
    }
  };

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
                  <div className="mt-2 text-[11px] leading-relaxed text-muted">
                    {update.body}
                  </div>
                ) : null}
              </div>

              {error ? (
                <div className="mx-4 mb-3 rounded-lg border border-border/60 bg-background/24 px-3 py-2 text-[11px] text-muted">
                  {error}
                </div>
              ) : null}

              <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3">
                <button
                  type="button"
                  onClick={() => void handleInstall()}
                  disabled={installState === 'installing'}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/90 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {installState === 'installing' ? (
                    <>
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Installing…
                    </>
                  ) : (
                    'Install & Restart'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={installState === 'installing'}
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
