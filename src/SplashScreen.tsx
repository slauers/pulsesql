import { useEffect, useMemo, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getInitialLocale, translate } from './i18n';
import { LOCK_SPLASH_FOR_DEV } from './devFlags';
import PulseLoader from './components/ui/PulseLoader';
import { useConnectionsStore, getConnectionColor, hexToRgba } from './store/connections';

const MIN_SPLASH_MS = 5000;

interface SplashProgressPayload {
  progress: number;
  label?: string | null;
}

const locale = getInitialLocale();
const DEFAULT_LABEL = translate(locale, 'splashPreparingWorkspace');

export default function SplashScreen() {
  const [progress, setProgress] = useState(8);
  const [label, setLabel] = useState(DEFAULT_LABEL);
  const [finishing, setFinishing] = useState(false);
  const mountTimeRef = useRef(Date.now());

  const favoriteConnectionId = useConnectionsStore((s) => s.favoriteConnectionId);
  const connections = useConnectionsStore((s) => s.connections);
  const ecgColor = useMemo(
    () => getConnectionColor(connections, favoriteConnectionId),
    [connections, favoriteConnectionId],
  );

  const normalizedProgress = useMemo(() => Math.max(0, Math.min(progress, 100)), [progress]);

  const closeAfterMinimum = () => {
    const elapsed = Date.now() - mountTimeRef.current;
    const remaining = MIN_SPLASH_MS - elapsed;
    window.setTimeout(() => {
      void invoke('close_splash_window').catch(() => null);
    }, Math.max(0, remaining));
  };

  useEffect(() => {
    void invoke('show_splash_window').catch(() => null);
  }, []);

  useEffect(() => {
    if (LOCK_SPLASH_FOR_DEV) return;

    let cancelled = false;

    const syncInitialState = async () => {
      try {
        const currentState = await invoke<SplashProgressPayload & { finished?: boolean }>('get_splash_state');
        if (cancelled) return;
        setProgress(currentState.progress);
        setLabel(currentState.label?.trim() || DEFAULT_LABEL);
        if (currentState.finished) {
          setFinishing(true);
          closeAfterMinimum();
        }
      } catch {
        // Outside Tauri
      }
    };

    const unlistenProgressPromise = listen<SplashProgressPayload>('splash:progress', (event) => {
      if (cancelled) return;
      setProgress(event.payload.progress);
      setLabel(event.payload.label?.trim() || DEFAULT_LABEL);
    });

    const unlistenFinishPromise = listen('splash:finish', () => {
      if (cancelled) return;
      setFinishing(true);
      closeAfterMinimum();
    });

    void syncInitialState();

    return () => {
      cancelled = true;
      void unlistenProgressPromise.then((unlisten) => unlisten());
      void unlistenFinishPromise.then((unlisten) => unlisten());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (LOCK_SPLASH_FOR_DEV) {
      setProgress(8);
      setLabel(DEFAULT_LABEL);
      return;
    }

    if (finishing) {
      setProgress(100);
      setLabel(translate(locale, 'splashReady'));
      return;
    }

    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 94) return current;
        if (current < 36) return current + 4;
        if (current < 68) return current + 2;
        return current + 1;
      });
    }, 120);

    return () => window.clearInterval(timer);
  }, [finishing]);

  return (
    <div
      className={`splash-screen__card ${finishing ? 'splash-screen__card--closing' : ''}`}
      style={{
        '--splash-color-a': hexToRgba(ecgColor, 0.82),
        '--splash-color-b': hexToRgba(ecgColor, 0.72),
        '--splash-glow':    hexToRgba(ecgColor, 0.18),
      } as React.CSSProperties}
    >
      <div className="splash-screen__loader">
        <PulseLoader color={ecgColor} size="lg" surface="transparent" />
      </div>

      <div className="splash-screen__copy">
        <div className="splash-screen__title">PulseSQL</div>
        <div className="splash-screen__subtitle">{translate(locale, 'aboutSubtitle')}</div>
      </div>

      <div className="splash-screen__progress">
        <div
          className="splash-screen__progress-bar"
          style={{ transform: `scaleX(${normalizedProgress / 100})` }}
        />
      </div>

      <div className="splash-screen__status">
        <span>{label}</span>
        <span>{normalizedProgress}%</span>
      </div>
    </div>
  );
}
