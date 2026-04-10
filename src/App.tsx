import { useRef } from 'react';
import brandMark from './assets/blacktable-mark.svg';
import ConnectionManager from './features/connections/ConnectionManager';
import { useUiPreferencesStore } from './store/uiPreferences';

function App() {
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const setSemanticBackgroundEnabled = useUiPreferencesStore((state) => state.setSemanticBackgroundEnabled);
  const semanticToggleButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleSemanticBackgroundToggle = () => {
    setSemanticBackgroundEnabled(!semanticBackgroundEnabled);

    semanticToggleButtonRef.current?.animate(
      [
        {
          boxShadow: '0 0 0 rgba(110, 72, 255, 0)',
          borderColor: 'rgba(110, 72, 255, 0.35)',
          background: 'rgba(110, 72, 255, 0.08)',
          transform: 'translateY(0) scale(1)',
        },
        {
          boxShadow: '0 0 18px rgba(110, 72, 255, 0.28), 0 0 36px rgba(110, 72, 255, 0.16)',
          borderColor: 'rgba(110, 72, 255, 0.72)',
          background: 'rgba(110, 72, 255, 0.18)',
          transform: 'translateY(-1px) scale(1.03)',
        },
        {
          boxShadow: '0 0 0 rgba(110, 72, 255, 0)',
          borderColor: 'rgba(110, 72, 255, 0.35)',
          background: 'rgba(110, 72, 255, 0.08)',
          transform: 'translateY(0) scale(1)',
        },
      ],
      {
        duration: 720,
        easing: 'ease-out',
      },
    );
  };

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
          <button
            ref={semanticToggleButtonRef}
            type="button"
            onClick={handleSemanticBackgroundToggle}
            className={`rounded-lg border px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors ${
              semanticBackgroundEnabled
                ? 'border-primary/35 bg-primary/10 text-primary'
                : 'border-border/70 bg-background/18 text-muted hover:text-text'
            }`}
            title="Ligar ou desligar fundo semantico"
          >
            Fundo semantico {semanticBackgroundEnabled ? 'on' : 'off'}
          </button>
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
