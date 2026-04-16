import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';

interface JdkStatus {
  available: boolean;
  version: string | null;
  source: string;
  reason: string | null;
}

interface JdkProgressPayload {
  progress: number;
  label: string;
}

export default function JdkSetupBanner() {
  const [status, setStatus] = useState<JdkStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    invoke<JdkStatus>('check_jdk_status').then(setStatus).catch(() => {});
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    setProgress(0);
    setProgressLabel('Preparando...');

    const unlisten = await listen<JdkProgressPayload>('jdk:progress', (event) => {
      setProgress(event.payload.progress);
      setProgressLabel(event.payload.label);
    });
    unlistenRef.current = unlisten;

    try {
      await invoke('download_install_jdk');
      const updated = await invoke<JdkStatus>('check_jdk_status');
      setStatus(updated);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Instalacao falhou. Tente novamente.');
    } finally {
      unlisten();
      unlistenRef.current = null;
      setInstalling(false);
    }
  };

  if (!status) return null;

  if (status.available) {
    const label =
      status.source === 'bundled'
        ? `JDK ${status.version ?? ''} instalado pelo PulseSQL`
        : `JDK ${status.version ?? ''} detectado no sistema`;
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/8 px-3 py-2.5 text-xs text-green-400">
        <CheckCircle2 size={13} className="shrink-0" />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm">
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-400" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-amber-300 mb-0.5">
            {status.reason ? 'Java incompativel' : 'Java/JDK nao encontrado'}
          </div>
          <p className="text-xs text-amber-400/75 leading-relaxed">
            {status.reason
              ? status.reason
              : 'Conexoes Oracle requerem Java. O PulseSQL pode baixar e instalar o JDK Eclipse Temurin\u00a021 automaticamente.'}
          </p>

          {installing ? (
            <div className="mt-3 space-y-1.5">
              <div className="text-xs text-amber-400/70">{progressLabel}</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-950/60">
                <div
                  className="h-full rounded-full bg-amber-400 transition-[width] duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleInstall}
              className="mt-3 flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/25 transition-colors"
            >
              <Download size={12} />
              Instalar JDK automaticamente
            </button>
          )}

          {error ? (
            <p className="mt-2 text-xs text-red-400 leading-relaxed">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
