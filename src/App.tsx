import brandMark from './assets/blacktable-mark.svg';
import ConnectionManager from './features/connections/ConnectionManager';

function App() {
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
