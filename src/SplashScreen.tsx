import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import brandMark from './assets/blacktable-mark.svg';
import { getInitialLocale, translate } from './i18n';

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

  const normalizedProgress = useMemo(() => Math.max(0, Math.min(progress, 100)), [progress]);

  useEffect(() => {
    let cancelled = false;

    const syncInitialState = async () => {
      try {
        const currentState = await invoke<SplashProgressPayload & { finished?: boolean }>('get_splash_state');
        if (cancelled) {
          return;
        }

        setProgress(currentState.progress);
        setLabel(currentState.label?.trim() || DEFAULT_LABEL);

        if (currentState.finished) {
          setFinishing(true);
          window.setTimeout(() => {
            void invoke('close_splash_window').catch(() => null);
          }, 210);
        }
      } catch {
        // Ignore when running outside Tauri.
      }
    };

    const unlistenProgressPromise = listen<SplashProgressPayload>('splash:progress', (event) => {
      if (cancelled) {
        return;
      }

      setProgress(event.payload.progress);
      setLabel(event.payload.label?.trim() || DEFAULT_LABEL);
    });

    const unlistenFinishPromise = listen('splash:finish', () => {
      if (cancelled) {
        return;
      }

      setFinishing(true);
      window.setTimeout(() => {
        void invoke('close_splash_window').catch(() => null);
      }, 210);
    });

    void syncInitialState();

    return () => {
      cancelled = true;
      void unlistenProgressPromise.then((unlisten) => unlisten());
      void unlistenFinishPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (finishing) {
      setProgress(100);
      setLabel(translate(locale, 'splashReady'));
      return;
    }

    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 94) {
          return current;
        }

        if (current < 36) {
          return current + 4;
        }

        if (current < 68) {
          return current + 2;
        }

        return current + 1;
      });
    }, 120);

    return () => {
      window.clearInterval(timer);
    };
  }, [finishing]);

  return (
    <div className={`splash-screen ${finishing ? 'splash-screen--closing' : ''}`}>
      <div className="splash-screen__card">
        <div className="splash-screen__logo-shell">
          <img src={brandMark} alt="BlackTable" className="splash-screen__logo" />
        </div>

        <div className="splash-screen__copy">
          <div className="splash-screen__title">BlackTable</div>
          <div className="splash-screen__subtitle">{translate(locale, 'aboutSubtitle')}</div>
        </div>

        <div className="splash-screen__status">
          <span>{label}</span>
          <span>{normalizedProgress}%</span>
        </div>

        <div className="splash-screen__progress">
          <div
            className="splash-screen__progress-bar"
            style={{ transform: `scaleX(${normalizedProgress / 100})` }}
          />
        </div>
      </div>
    </div>
  );
}
