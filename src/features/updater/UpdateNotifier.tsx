import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';

export interface UpdateInfo {
  version: string;
  body: string | null;
}

type InstallState = 'idle' | 'installing' | 'done';

export function UpdateNotifier({ update, onDismiss }: { update: UpdateInfo; onDismiss: () => void }) {
  const [installState, setInstallState] = useState<InstallState>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setInstallState('installing');
    setError(null);
    try {
      await invoke('install_update');
      // install_update calls app.restart() on the Rust side — if we reach here the
      // platform delayed the restart, so we show a "done" state.
      setInstallState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setInstallState('idle');
    }
  };

  return createPortal(
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-[200] w-[320px] overflow-hidden rounded-xl border border-border/80 bg-surface/95 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-semibold text-text">Update available</span>
          <span className="text-[12px] text-muted">PulseSQL {update.version} is ready to install.</span>
        </div>
        {installState === 'idle' ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss update notification"
            className="mt-0.5 shrink-0 rounded p-0.5 text-muted hover:bg-border/30 hover:text-text"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="mx-4 mb-3 rounded-lg border border-border/60 bg-background/24 px-3 py-2 text-[11px] text-muted">
          {error}
        </div>
      ) : null}

      <div className="flex gap-2 border-t border-border/60 px-4 py-3">
        {installState === 'done' ? (
          <span className="text-[12px] text-muted">Restarting…</span>
        ) : (
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
              <>
                <Download size={12} />
                Install &amp; Restart
              </>
            )}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
