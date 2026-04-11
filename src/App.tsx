import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import brandMark from './assets/blacktable-mark.svg';
import ConnectionManager from './features/connections/ConnectionManager';
import { useQueriesStore } from './store/queries';
import { useConnectionsStore } from './store/connections';
import { useDatabaseSessionStore } from './store/databaseSession';
import { useUiPreferencesStore } from './store/uiPreferences';

function App() {
  const tabs = useQueriesStore((state) => state.tabs);
  const activeTabId = useQueriesStore((state) => state.activeTabId);
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnectionId = useConnectionsStore((state) => state.activeConnectionId);
  const activeSchemas = useDatabaseSessionStore((state) => state.activeSchemaByConnection);
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const startupSequenceStartedRef = useRef(false);
  const startupSequenceFinishedRef = useRef(false);

  useEffect(() => {
    if (startupSequenceStartedRef.current || startupSequenceFinishedRef.current) {
      return;
    }

    startupSequenceStartedRef.current = true;

    const runStartupSequence = async () => {
      await emitSplashProgress(18, 'Loading interface shell');
      await nextFrame();

      const sessionReady =
        tabs.length >= 1 &&
        Boolean(activeTabId) &&
        Array.isArray(connections) &&
        typeof semanticBackgroundEnabled === 'boolean';

      await emitSplashProgress(
        sessionReady ? 52 : 38,
        'Restoring session state',
      );
      await nextFrame();

      const workspaceReady =
        connections.length === 0 ||
        !activeConnectionId ||
        typeof activeSchemas[activeConnectionId] !== 'undefined' ||
        activeSchemas[activeConnectionId] === null;

      await emitSplashProgress(
        workspaceReady ? 82 : 68,
        'Hydrating workspace',
      );
      await wait(180);

      startupSequenceFinishedRef.current = true;
      await emitSplashProgress(100, 'Ready');
      await wait(120);
      await invokeSafely('reveal_main_window');
    };

    void runStartupSequence();
  }, [activeConnectionId, activeSchemas, activeTabId, connections, semanticBackgroundEnabled, tabs]);

  return (
    <div className="h-screen w-screen bg-background text-text overflow-hidden flex flex-col relative p-3">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute inset-0 grid-sheen" />
        <div className="absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      </div>

      <div className="h-14 rounded-lg border border-border/80 glass-panel flex items-center justify-between px-4 shrink-0 relative z-10 shadow-[0_24px_70px_rgba(0,0,0,0.26)]">
        <div className="flex items-center gap-3 min-w-0">
          <img src={brandMark} alt="BlackTable" className="h-8 w-8 rounded-lg border border-border/80 shadow-[0_0_20px_rgba(34,199,255,0.14)]" />
          <div className="min-w-0">
            <h1 className="font-medium text-sm tracking-[0.06em] text-text truncate">
              Blacktable
            </h1>
            <p className="text-[11px] text-muted truncate">
              Lightweight SQL workstation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:block text-[10px] uppercase tracking-[0.14em] text-primary/70">
            Grid-native SQL Client
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative z-10 pt-3">
        <ConnectionManager />
      </div>
    </div>
  );
}

export default App;

async function emitSplashProgress(progress: number, label: string) {
  await invokeSafely('update_splash_progress', {
    progress,
    label,
  });
}

async function invokeSafely(command: string, payload?: Record<string, unknown>) {
  try {
    await invoke(command, payload);
  } catch {
    // Browser-only renders or non-Tauri previews should ignore splash calls.
  }
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
