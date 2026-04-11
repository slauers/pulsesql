import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ChevronDown, CircleHelp, Command, Info, Settings2, SquareTerminal, Waypoints } from 'lucide-react';
import brandMark from './assets/blacktable-mark.svg';
import ConnectionManager from './features/connections/ConnectionManager';
import ConfigurationDialog from './features/settings/ConfigurationDialog';
import { useQueriesStore } from './store/queries';
import { useConnectionsStore } from './store/connections';
import { useConnectionRuntimeStore } from './store/connectionRuntime';
import { useDatabaseSessionStore } from './store/databaseSession';
import { useUiPreferencesStore } from './store/uiPreferences';
import { getThemeById } from './themes';

function App() {
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabs = useQueriesStore((state) => state.tabs);
  const activeTabId = useQueriesStore((state) => state.activeTabId);
  const addTab = useQueriesStore((state) => state.addTab);
  const closeTab = useQueriesStore((state) => state.closeTab);
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnectionId = useConnectionsStore((state) => state.activeConnectionId);
  const favoriteConnectionId = useConnectionsStore((state) => state.favoriteConnectionId);
  const setActiveConnection = useConnectionsStore((state) => state.setActiveConnection);
  const activeSchemas = useDatabaseSessionStore((state) => state.activeSchemaByConnection);
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const setSemanticBackgroundEnabled = useUiPreferencesStore((state) => state.setSemanticBackgroundEnabled);
  const themeId = useUiPreferencesStore((state) => state.themeId);
  const density = useUiPreferencesStore((state) => state.density);
  const commandPaletteShortcut = useUiPreferencesStore((state) => state.commandPaletteShortcut);
  const newQueryTabShortcut = useUiPreferencesStore((state) => state.newQueryTabShortcut);
  const runtimeStatus = useConnectionRuntimeStore((state) => state.runtimeStatus);
  const appendLog = useConnectionRuntimeStore((state) => state.appendLog);
  const setRuntimeStatus = useConnectionRuntimeStore((state) => state.setRuntimeStatus);
  const startupSequenceStartedRef = useRef(false);
  const startupSequenceFinishedRef = useRef(false);
  const autoConnectStartedRef = useRef(false);
  const [activeMenu, setActiveMenu] = useState<'file' | 'edit' | 'view' | 'help' | 'about' | null>(null);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const activeTheme = useMemo(() => getThemeById(themeId), [themeId]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.dataset.theme = activeTheme.id;
    root.dataset.density = density;
    body.dataset.theme = activeTheme.id;
    body.dataset.density = density;
    root.style.setProperty('--bt-background', activeTheme.colors.background);
    root.style.setProperty('--bt-surface', activeTheme.colors.surface);
    root.style.setProperty('--bt-border', activeTheme.colors.border);
    root.style.setProperty('--bt-primary', activeTheme.colors.primary);
    root.style.setProperty('--bt-text', activeTheme.colors.text);
    root.style.setProperty('--bt-muted', activeTheme.colors.muted);
    root.style.setProperty('--bt-body-background', activeTheme.colors.bodyBackground);
    root.style.setProperty('--bt-glass-panel', activeTheme.colors.glassPanel);
    root.style.setProperty('--bt-color-scheme', activeTheme.mode);
  }, [activeTheme, density]);

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

  useEffect(() => {
    const hasLiveActiveConnection = Boolean(
      activeConnectionId && runtimeStatus[activeConnectionId] === 'connected',
    );

    if (autoConnectStartedRef.current || hasLiveActiveConnection || !favoriteConnectionId) {
      return;
    }

    const favoriteConnection = connections.find((connection) => connection.id === favoriteConnectionId);
    if (!favoriteConnection) {
      return;
    }

    autoConnectStartedRef.current = true;

    const openFavoriteConnection = async () => {
      setActiveConnection(favoriteConnection.id);
      setRuntimeStatus(favoriteConnection.id, 'connecting');
      appendLog(favoriteConnection.id, `Abrindo conexao favorita ${favoriteConnection.name} na inicializacao.`);

      try {
        await invoke('open_connection', { config: favoriteConnection });
        setRuntimeStatus(favoriteConnection.id, 'connected');
        setActiveConnection(favoriteConnection.id);
        appendLog(favoriteConnection.id, 'Conexao favorita aberta automaticamente.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRuntimeStatus(favoriteConnection.id, 'failed');
        appendLog(favoriteConnection.id, `Falha ao abrir conexao favorita automaticamente: ${message}`);
      }
    };

    void openFavoriteConnection();
  }, [activeConnectionId, appendLog, connections, favoriteConnectionId, runtimeStatus, setActiveConnection, setRuntimeStatus]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, commandPaletteShortcut)) {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }

      if (matchesShortcut(event, newQueryTabShortcut)) {
        event.preventDefault();
        addTab();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addTab, commandPaletteShortcut, newQueryTabShortcut]);

  useEffect(() => {
    if (!activeMenu) {
      return;
    }

    const updatePosition = () => {
      const button = menuButtonRefs.current[activeMenu];
      if (!button) {
        return;
      }

      const rect = button.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 8,
        left: Math.max(8, rect.right - 220),
      });
    };

    updatePosition();

    const handlePointerDown = () => setActiveMenu(null);
    const handleReposition = () => updatePosition();
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [activeMenu]);

  const openNewConnectionForm = () => {
    window.dispatchEvent(new CustomEvent('blacktable:new-connection'));
  };

  const toggleConnectionsSidebar = () => {
    window.dispatchEvent(new CustomEvent('blacktable:toggle-sidebar'));
  };

  const handleCloseCurrentTab = () => {
    if (activeTabId) {
      closeTab(activeTabId);
    }
  };

  const handleExitApplication = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  const openCommandPalette = () => {
    setActiveMenu(null);
    setCommandPaletteOpen(true);
  };

  const menuDefinitions: Array<{
    id: 'file' | 'edit' | 'view' | 'help' | 'about';
    label: string;
    items: Array<{ label: string; onClick: () => void; disabled?: boolean; icon?: typeof Settings2 }>;
  }> = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'New Connection...', onClick: openNewConnectionForm, icon: Waypoints },
        { label: 'Configuration...', onClick: () => setConfigurationOpen(true), icon: Settings2 },
        { label: 'Exit', onClick: () => void handleExitApplication() },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { label: 'New Query Tab', onClick: addTab, icon: SquareTerminal },
        { label: 'Close Query Tab', onClick: handleCloseCurrentTab, disabled: !activeTabId },
        { label: 'Command Palette', onClick: openCommandPalette, icon: Command },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          label: semanticBackgroundEnabled ? 'Disable Semantic Background' : 'Enable Semantic Background',
          onClick: () => setSemanticBackgroundEnabled(!semanticBackgroundEnabled),
        },
        { label: 'Toggle Connections Sidebar', onClick: toggleConnectionsSidebar },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', onClick: () => setHelpOpen(true), icon: CircleHelp },
      ],
    },
    {
      id: 'about',
      label: 'About',
      items: [
        { label: 'About Blacktable', onClick: () => setAboutOpen(true), icon: Info },
      ],
    },
  ];

  return (
    <div className={`h-screen w-screen overflow-hidden bg-background text-text flex flex-col relative bt-density-${density}`}>
      <div className="h-8 shrink-0 border-b border-border/80 bg-surface px-2 relative z-20">
        <div className="flex h-full items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <img src={brandMark} alt="BlackTable" className="h-4 w-4 shrink-0" />
            <div className="flex items-center gap-0.5">
          <div className="flex items-center gap-1">
            {menuDefinitions.map((menu) => (
              <div key={menu.id} className="relative">
                <button
                  ref={(element) => {
                    menuButtonRefs.current[menu.id] = element;
                  }}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveMenu((current) => (current === menu.id ? null : menu.id));
                  }}
                  className={`inline-flex h-6 items-center gap-1 px-2 text-[12px] ${
                    activeMenu === menu.id
                      ? 'bg-background/70 text-text'
                      : 'text-muted hover:bg-background/55 hover:text-text'
                  }`}
                >
                  <span>{menu.label}</span>
                </button>
              </div>
            ))}
          </div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 text-[11px] text-muted">
            <span>{activeTheme.label}</span>
            <ChevronDown size={11} className="opacity-40" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative z-10">
        <ConnectionManager />
      </div>

      {activeMenu && menuPosition
        ? createPortal(
            <div
              className="fixed z-[180] min-w-[220px] border border-border/80 bg-surface/95 p-1 shadow-[0_16px_48px_rgba(0,0,0,0.45)]"
              style={{ top: menuPosition.top, left: menuPosition.left }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {menuDefinitions
                .find((menu) => menu.id === activeMenu)
                ?.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      type="button"
                      disabled={item.disabled}
                      onClick={() => {
                        setActiveMenu(null);
                        item.onClick();
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-text transition-colors hover:bg-primary/20 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {Icon ? <Icon size={14} className="text-muted" /> : <span className="w-[14px]" />}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
            </div>,
            document.body,
          )
        : null}

      <ConfigurationDialog open={configurationOpen} onClose={() => setConfigurationOpen(false)} />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        commands={buildCommandPaletteCommands({
          addTab,
          activeTabId,
          closeTab,
          activeConnectionId,
          openNewConnectionForm,
          openConfiguration: () => setConfigurationOpen(true),
          toggleConnectionsSidebar,
          toggleSemanticBackground: () => setSemanticBackgroundEnabled(!semanticBackgroundEnabled),
          openHelp: () => setHelpOpen(true),
          openAbout: () => setAboutOpen(true),
        })}
      />
      <InfoDialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        title="Keyboard Shortcuts"
        subtitle="Atalhos globais configuraveis"
        lines={[
          `${commandPaletteShortcut}: abre a command palette`,
          `${newQueryTabShortcut}: cria uma nova aba de query`,
          'Cmd/Ctrl + Enter: executa a query atual no editor',
          'File > Configuration...: abre as configuracoes do sistema',
        ]}
      />
      <InfoDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        title="About Blacktable"
        subtitle="Grid-native SQL workstation"
        lines={[
          'Blacktable',
          'Desktop SQL client focado em editor, explorer e grid de resultados.',
          'Inclui configuracao central, conexao favorita com autoabertura e paginação de resultados.',
        ]}
      />
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

function InfoDialog({
  open,
  onClose,
  title,
  subtitle,
  lines,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  lines: string[];
}) {
  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-background/78 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-border bg-surface/95 shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-5 py-4">
          <div className="text-sm font-semibold text-text">{title}</div>
          <div className="mt-1 text-xs text-muted">{subtitle}</div>
        </div>
        <div className="px-5 py-4 text-sm text-text">
          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line} className="rounded-lg border border-border/60 bg-background/24 px-3 py-2">
                {line}
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Array<{ id: string; label: string; description: string; action: () => void; disabled?: boolean }>;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }

    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const filteredCommands = commands.filter((command) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    return `${command.label} ${command.description}`.toLowerCase().includes(normalized);
  });

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[175] bg-background/72 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="mx-auto mt-[12vh] w-full max-w-2xl px-6" onMouseDown={(event) => event.stopPropagation()}>
        <div className="overflow-hidden rounded-2xl border border-border/80 bg-surface/95 shadow-[0_32px_120px_rgba(0,0,0,0.52)]">
          <div className="border-b border-border/70 px-4 py-3">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  onClose();
                }

                if (event.key === 'Enter' && filteredCommands[0] && !filteredCommands[0].disabled) {
                  event.preventDefault();
                  onClose();
                  filteredCommands[0].action();
                }
              }}
              placeholder="Digite um comando..."
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </div>
          <div className="max-h-[50vh] overflow-auto p-2">
            {filteredCommands.length ? (
              filteredCommands.map((command) => (
                <button
                  key={command.id}
                  type="button"
                  disabled={command.disabled}
                  onClick={() => {
                    onClose();
                    command.action();
                  }}
                  className="flex w-full items-start justify-between rounded-xl px-3 py-3 text-left transition-colors hover:bg-background/55 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <div>
                    <div className="text-sm text-text">{command.label}</div>
                    <div className="mt-1 text-xs text-muted">{command.description}</div>
                  </div>
                </button>
              ))
            ) : (
              <div className="px-3 py-5 text-sm text-muted">Nenhum comando encontrado.</div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function buildCommandPaletteCommands(params: {
  addTab: () => void;
  activeTabId: string | null;
  closeTab: (id: string) => void;
  activeConnectionId: string | null;
  openNewConnectionForm: () => void;
  openConfiguration: () => void;
  toggleConnectionsSidebar: () => void;
  toggleSemanticBackground: () => void;
  openHelp: () => void;
  openAbout: () => void;
}) {
  return [
    {
      id: 'new-connection',
      label: 'Nova conexao',
      description: 'Abre o formulario de conexao',
      action: params.openNewConnectionForm,
    },
    {
      id: 'new-query-tab',
      label: 'Nova aba de query',
      description: 'Cria uma nova aba no editor',
      action: params.addTab,
    },
    {
      id: 'close-query-tab',
      label: 'Fechar aba de query',
      description: 'Fecha a aba ativa',
      action: () => {
        if (params.activeTabId) {
          params.closeTab(params.activeTabId);
        }
      },
      disabled: !params.activeTabId,
    },
    {
      id: 'configuration',
      label: 'Configuracoes',
      description: 'Abre a configuracao do sistema',
      action: params.openConfiguration,
    },
    {
      id: 'toggle-sidebar',
      label: 'Alternar sidebar de conexoes',
      description: 'Mostra ou oculta a lateral',
      action: params.toggleConnectionsSidebar,
    },
    {
      id: 'toggle-semantic-background',
      label: 'Alternar fundo semantico',
      description: 'Liga ou desliga o fundo semantico',
      action: params.toggleSemanticBackground,
    },
    {
      id: 'help',
      label: 'Atalhos de teclado',
      description: 'Abre a ajuda rapida do app',
      action: params.openHelp,
    },
    {
      id: 'about',
      label: 'Sobre o Blacktable',
      description: 'Abre informacoes do aplicativo',
      action: params.openAbout,
    },
  ];
}

function matchesShortcut(event: KeyboardEvent, shortcut: string) {
  const parts = shortcut
    .split('+')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (!parts.length) {
    return false;
  }

  const mainKey = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1));
  const isMac = navigator.platform.toLowerCase().includes('mac');
  const expectsCmdOrCtrl = modifiers.has('cmdorctrl') ? (isMac ? event.metaKey : event.ctrlKey) : !event.metaKey && !event.ctrlKey;
  const expectsCtrl = modifiers.has('ctrl') ? event.ctrlKey : !modifiers.has('ctrl');
  const expectsCmd = modifiers.has('cmd') ? event.metaKey : !modifiers.has('cmd');
  const expectsShift = modifiers.has('shift') ? event.shiftKey : !modifiers.has('shift') || !event.shiftKey;
  const expectsAlt = modifiers.has('alt') ? event.altKey : !modifiers.has('alt') || !event.altKey;

  return (
    expectsCmdOrCtrl &&
    expectsCtrl &&
    expectsCmd &&
    expectsShift &&
    expectsAlt &&
    event.key.toLowerCase() === mainKey.toLowerCase()
  );
}
