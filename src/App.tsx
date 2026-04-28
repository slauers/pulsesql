import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { createPortal } from 'react-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Menu, MenuItem, Submenu, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { readText as clipboardReadText, writeText as clipboardWriteText } from '@tauri-apps/plugin-clipboard-manager';
import tauriConfig from '../src-tauri/tauri.conf.json';
import ConnectionManager from './features/connections/ConnectionManager';
import ConfigurationDialog from './features/settings/ConfigurationDialog';
import { useQueriesStore } from './store/queries';
import { useConnectionsStore } from './store/connections';
import { useConnectionRuntimeStore } from './store/connectionRuntime';
import { useDatabaseSessionStore } from './store/databaseSession';
import { useUiPreferencesStore } from './store/uiPreferences';
import { getThemeById } from './themes';
import { translate, type AppLocale } from './i18n';
import { LOCK_SPLASH_FOR_DEV } from './devFlags';
import { UpdateButton, type UpdateInfo } from './features/updater/UpdateNotifier';

function App() {
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
  const semanticBackgroundState = useUiPreferencesStore((state) => state.semanticBackgroundState);
  const locale = useUiPreferencesStore((state) => state.locale);
  const themeId = useUiPreferencesStore((state) => state.themeId);
  const density = useUiPreferencesStore((state) => state.density);
  const commandPaletteShortcut = useUiPreferencesStore((state) => state.commandPaletteShortcut);
  const newQueryTabShortcut = useUiPreferencesStore((state) => state.newQueryTabShortcut);
  const closeQueryTabShortcut = useUiPreferencesStore((state) => state.closeQueryTabShortcut);
  const runtimeStatus = useConnectionRuntimeStore((state) => state.runtimeStatus);
  const appendLog = useConnectionRuntimeStore((state) => state.appendLog);
  const setRuntimeStatus = useConnectionRuntimeStore((state) => state.setRuntimeStatus);
  const startupSequenceStartedRef = useRef(false);
  const startupSequenceFinishedRef = useRef(false);
  const autoConnectStartedRef = useRef(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<UpdateInfo | null>(null);
  const activeTheme = useMemo(() => getThemeById(themeId), [themeId]);

  const handlersRef = useRef({
    addTab,
    handleCloseCurrentTab: () => { if (activeTabId) closeTab(activeTabId); },
    openCommandPalette: () => setCommandPaletteOpen(true),
    openNewConnectionForm: () => { window.dispatchEvent(new CustomEvent('pulsesql:new-connection')); },
    setConfigurationOpen,
    setHelpOpen,
    setAboutOpen,
    semanticBackgroundEnabled,
    setSemanticBackgroundEnabled,
    toggleConnectionsSidebar: () => { window.dispatchEvent(new CustomEvent('pulsesql:toggle-sidebar')); },
    handleExitApplication: async () => {
      try { await getCurrentWindow().close(); } catch { window.close(); }
    },
  });

  useEffect(() => {
    const handleClipboardShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== 'c' && key !== 'x' && key !== 'v') {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target || target.closest('.monaco-editor')) {
        return;
      }

      const editable = resolveClipboardEditable(target);
      if (!editable) {
        if (key === 'c') {
          const selectedText = window.getSelection()?.toString() ?? '';
          if (selectedText) {
            event.preventDefault();
            void clipboardWriteText(selectedText);
          }
        }
        return;
      }

      event.preventDefault();

      if (key === 'c' || key === 'x') {
        const value = editable.getSelectedText();
        void clipboardWriteText(value);
        if (key === 'x' && !editable.readOnly) {
          editable.replaceSelection('');
        }
        return;
      }

      if (key === 'v' && !editable.readOnly) {
        void clipboardReadText().then((text) => {
          if (text) {
            editable.replaceSelection(text);
          }
        });
      }
    };

    window.addEventListener('keydown', handleClipboardShortcut, true);
    return () => window.removeEventListener('keydown', handleClipboardShortcut, true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const backgroundRgb = toRgbChannels(activeTheme.colors.background);
    const surfaceRgb = toRgbChannels(activeTheme.colors.surface);
    const borderRgb = toRgbChannels(activeTheme.colors.border);
    const primaryRgb = toRgbChannels(activeTheme.colors.primary);
    const textRgb = toRgbChannels(activeTheme.colors.text);
    const mutedRgb = toRgbChannels(activeTheme.colors.muted);
    root.dataset.theme = activeTheme.id;
    root.dataset.density = density;
    body.dataset.theme = activeTheme.id;
    body.dataset.density = density;
    root.style.setProperty('--bt-background', activeTheme.colors.background);
    root.style.setProperty('--bt-background-rgb', backgroundRgb);
    root.style.setProperty('--bt-surface', activeTheme.colors.surface);
    root.style.setProperty('--bt-surface-rgb', surfaceRgb);
    root.style.setProperty('--bt-border', activeTheme.colors.border);
    root.style.setProperty('--bt-border-rgb', borderRgb);
    root.style.setProperty('--bt-primary', activeTheme.colors.primary);
    root.style.setProperty('--bt-primary-rgb', primaryRgb);
    root.style.setProperty('--bt-text', activeTheme.colors.text);
    root.style.setProperty('--bt-text-rgb', textRgb);
    root.style.setProperty('--bt-muted', activeTheme.colors.muted);
    root.style.setProperty('--bt-muted-rgb', mutedRgb);
    root.style.setProperty('--bt-body-background', activeTheme.colors.bodyBackground);
    root.style.setProperty('--bt-glass-panel', activeTheme.colors.glassPanel);
    root.style.setProperty('--bt-color-scheme', activeTheme.mode);
  }, [activeTheme, density]);

  useEffect(() => {
    if (LOCK_SPLASH_FOR_DEV) {
      return;
    }

    if (startupSequenceStartedRef.current || startupSequenceFinishedRef.current) {
      return;
    }

    startupSequenceStartedRef.current = true;

    const runStartupSequence = async () => {
      await emitSplashProgress(18, translate(locale, 'splashLoadingInterface'));
      await invokeSafely('clear_all_local_metadata');
      await nextFrame();

      const sessionReady =
        tabs.length >= 1 &&
        Boolean(activeTabId) &&
        Array.isArray(connections) &&
        typeof semanticBackgroundEnabled === 'boolean';

      await emitSplashProgress(
        sessionReady ? 52 : 38,
        translate(locale, 'splashRestoringSession'),
      );
      await nextFrame();

      const workspaceReady =
        connections.length === 0 ||
        !activeConnectionId ||
        typeof activeSchemas[activeConnectionId] !== 'undefined' ||
        activeSchemas[activeConnectionId] === null;

      await emitSplashProgress(
        workspaceReady ? 82 : 68,
        translate(locale, 'splashHydratingWorkspace'),
      );
      await wait(180);

      startupSequenceFinishedRef.current = true;
      await emitSplashProgress(100, translate(locale, 'splashReady'));
      await wait(120);
      await invokeSafely('reveal_main_window');

      // Non-blocking update check — runs after the window is visible.
      void invoke<UpdateInfo | null>('check_for_updates').then((update) => {
        if (update) {
          setPendingUpdate(update);
        }
      }).catch(() => {
        // Updater not configured or network unavailable — ignore silently.
      });
    };

    void runStartupSequence();
  }, [activeConnectionId, activeSchemas, activeTabId, connections, locale, semanticBackgroundEnabled, tabs]);

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
      appendLog(
        favoriteConnection.id,
        translate(locale, 'openFavoriteConnectionOnStartup', { name: favoriteConnection.name }),
      );

      try {
        await invoke('open_connection', { config: favoriteConnection });
        setRuntimeStatus(favoriteConnection.id, 'connected');
        setActiveConnection(favoriteConnection.id);
        appendLog(favoriteConnection.id, translate(locale, 'favoriteConnectionOpenedAutomatically'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRuntimeStatus(favoriteConnection.id, 'failed');
        appendLog(
          favoriteConnection.id,
          translate(locale, 'failedToOpenFavoriteAutomatically', { message }),
        );
      }
    };

    void openFavoriteConnection();
  }, [activeConnectionId, appendLog, connections, favoriteConnectionId, locale, runtimeStatus, setActiveConnection, setRuntimeStatus]);

  // Keep handlersRef current on every render so native menu callbacks always have latest state.
  handlersRef.current = {
    addTab,
    handleCloseCurrentTab: () => { if (activeTabId) closeTab(activeTabId); },
    openCommandPalette: () => setCommandPaletteOpen(true),
    openNewConnectionForm: () => { window.dispatchEvent(new CustomEvent('pulsesql:new-connection')); },
    setConfigurationOpen,
    setHelpOpen,
    setAboutOpen,
    semanticBackgroundEnabled,
    setSemanticBackgroundEnabled,
    toggleConnectionsSidebar: () => { window.dispatchEvent(new CustomEvent('pulsesql:toggle-sidebar')); },
    handleExitApplication: async () => {
      try { await getCurrentWindow().close(); } catch { window.close(); }
    },
  };

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
        return;
      }

      if (matchesShortcut(event, closeQueryTabShortcut)) {
        event.preventDefault();
        if (activeTabId) {
          closeTab(activeTabId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, addTab, closeQueryTabShortcut, closeTab, commandPaletteShortcut, newQueryTabShortcut]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const buildMenu = async () => {
      const separator = await PredefinedMenuItem.new({ item: 'Separator' });
      const quit = await PredefinedMenuItem.new({ item: 'Quit' });

      const fileMenu = await Submenu.new({
        text: translate(locale, 'file'),
        items: [
          await MenuItem.new({ text: translate(locale, 'newConnection'), action: () => handlersRef.current.openNewConnectionForm() }),
          await MenuItem.new({ text: translate(locale, 'configuration'), action: () => handlersRef.current.setConfigurationOpen(true) }),
          separator,
          quit,
        ],
      });

      const editMenu = await Submenu.new({
        text: translate(locale, 'edit'),
        items: [
          await MenuItem.new({ text: translate(locale, 'newQueryTab'), action: () => handlersRef.current.addTab() }),
          await MenuItem.new({ text: translate(locale, 'closeQueryTab'), action: () => handlersRef.current.handleCloseCurrentTab() }),
          await MenuItem.new({ text: translate(locale, 'commandPalette'), action: () => handlersRef.current.openCommandPalette() }),
        ],
      });

      const viewMenu = await Submenu.new({
        text: translate(locale, 'view'),
        items: [
          await MenuItem.new({
            text: handlersRef.current.semanticBackgroundEnabled
              ? translate(locale, 'disableSemanticBackground')
              : translate(locale, 'enableSemanticBackground'),
            action: () => handlersRef.current.setSemanticBackgroundEnabled(!handlersRef.current.semanticBackgroundEnabled),
          }),
          await MenuItem.new({ text: translate(locale, 'toggleConnectionsSidebar'), action: () => handlersRef.current.toggleConnectionsSidebar() }),
        ],
      });

      const helpMenu = await Submenu.new({
        text: translate(locale, 'help'),
        items: [
          await MenuItem.new({ text: translate(locale, 'keyboardShortcuts'), action: () => handlersRef.current.setHelpOpen(true) }),
          await PredefinedMenuItem.new({ item: 'Separator' }),
          await MenuItem.new({ text: translate(locale, 'aboutBlacktable'), action: () => handlersRef.current.setAboutOpen(true) }),
        ],
      });

      const menu = await Menu.new({ items: [fileMenu, editMenu, viewMenu, helpMenu] });
      await menu.setAsAppMenu();
    };

    void buildMenu();
  }, [locale]);

  const openNewConnectionForm = () => {
    window.dispatchEvent(new CustomEvent('pulsesql:new-connection'));
  };

  const toggleConnectionsSidebar = () => {
    window.dispatchEvent(new CustomEvent('pulsesql:toggle-sidebar'));
  };

  return (
    <div className={`atlas-app-background h-screen w-screen overflow-hidden bg-background text-text flex flex-col relative bt-density-${density}`}>
      {pendingUpdate ? (
        <div className="shrink-0 flex items-center justify-end border-b border-primary/30 bg-primary/8 relative z-20 px-3 py-1.5">
          <UpdateButton update={pendingUpdate} />
        </div>
      ) : null}

      <div className="atlas-app-frame-shell relative z-10 min-h-0 flex-1 overflow-hidden">
        <div className={`atlas-app-frame atlas-frame-state-${semanticBackgroundState}`}>
          <ConnectionManager />
        </div>
      </div>

      <ConfigurationDialog open={configurationOpen} onClose={() => setConfigurationOpen(false)} />
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        locale={locale}
        commands={buildCommandPaletteCommands({
          locale,
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
        locale={locale}
        onClose={() => setHelpOpen(false)}
        title={translate(locale, 'keyboardShortcutsTitle')}
        subtitle={translate(locale, 'keyboardShortcutsSubtitle')}
        lines={[
          `${commandPaletteShortcut}: ${translate(locale, 'opensCommandPalette')}`,
          `${newQueryTabShortcut}: ${translate(locale, 'createsNewQueryTab')}`,
          `${closeQueryTabShortcut}: ${translate(locale, 'closesCurrentQueryTab')}`,
          `Cmd/Ctrl + Enter: ${translate(locale, 'runsCurrentQuery')}`,
          `${translate(locale, 'file')} > ${translate(locale, 'configuration')}: ${translate(locale, 'opensSystemConfiguration')}`,
        ]}
      />
      <InfoDialog
        open={aboutOpen}
        locale={locale}
        onClose={() => setAboutOpen(false)}
        title={translate(locale, 'aboutTitle')}
        subtitle={translate(locale, 'aboutSubtitle')}
        lines={[
          translate(locale, 'aboutLine1'),
          `${translate(locale, 'aboutVersion')}: ${tauriConfig.version}`,
          translate(locale, 'aboutLine2'),
          translate(locale, 'aboutLine3'),
        ]}
      />
    </div>
  );
}

export default App;

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

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
  locale,
  onClose,
  title,
  subtitle,
  lines,
}: {
  open: boolean;
  locale: AppLocale;
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
            {translate(locale, 'close')}
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
  locale,
}: {
  open: boolean;
  onClose: () => void;
  commands: Array<{ id: string; label: string; description: string; action: () => void; disabled?: boolean }>;
  locale: AppLocale;
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
              placeholder={translate(locale, 'commandPalettePlaceholder')}
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
              <div className="px-3 py-5 text-sm text-muted">{translate(locale, 'noCommandFound')}</div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function buildCommandPaletteCommands(params: {
  locale: AppLocale;
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
      label: translate(params.locale, 'newConnection'),
      description: translate(params.locale, 'connectionFormNewTitle'),
      action: params.openNewConnectionForm,
    },
    {
      id: 'new-query-tab',
      label: translate(params.locale, 'newQueryTab'),
      description: translate(params.locale, 'createsNewQueryTab'),
      action: params.addTab,
    },
    {
      id: 'close-query-tab',
      label: translate(params.locale, 'closeQueryTab'),
      description: translate(params.locale, 'closeQueryTab'),
      action: () => {
        if (params.activeTabId) {
          params.closeTab(params.activeTabId);
        }
      },
      disabled: !params.activeTabId,
    },
    {
      id: 'configuration',
      label: translate(params.locale, 'configuration'),
      description: translate(params.locale, 'opensSystemConfiguration'),
      action: params.openConfiguration,
    },
    {
      id: 'toggle-sidebar',
      label: translate(params.locale, 'toggleConnectionsSidebar'),
      description: translate(params.locale, 'toggleConnectionsSidebar'),
      action: params.toggleConnectionsSidebar,
    },
    {
      id: 'toggle-semantic-background',
      label: translate(params.locale, 'semanticBackground'),
      description: translate(params.locale, 'semanticBackgroundDescription'),
      action: params.toggleSemanticBackground,
    },
    {
      id: 'help',
      label: translate(params.locale, 'keyboardShortcuts'),
      description: translate(params.locale, 'keyboardShortcutsSubtitle'),
      action: params.openHelp,
    },
    {
      id: 'about',
      label: translate(params.locale, 'aboutBlacktable'),
      description: translate(params.locale, 'aboutSubtitle'),
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

  const hasCmdOrCtrl = modifiers.has('cmdorctrl');
  const hasCtrl = modifiers.has('ctrl');
  const hasCmd = modifiers.has('cmd');

  // CmdOrCtrl resolves to Cmd on Mac, Ctrl on other platforms
  if (hasCmdOrCtrl) {
    if (isMac ? !event.metaKey : !event.ctrlKey) return false;
  }

  // Ctrl — skip the absence check when cmdorctrl already claimed ctrl on Windows
  if (hasCtrl) {
    if (!event.ctrlKey) return false;
  } else if (!hasCmdOrCtrl || isMac) {
    if (event.ctrlKey) return false;
  }

  // Cmd/Meta — skip the absence check when cmdorctrl already claimed meta on Mac
  if (hasCmd) {
    if (!event.metaKey) return false;
  } else if (!hasCmdOrCtrl || !isMac) {
    if (event.metaKey) return false;
  }

  // Shift — must match exactly
  if (modifiers.has('shift') ? !event.shiftKey : event.shiftKey) return false;

  // Alt — must match exactly
  if (modifiers.has('alt') ? !event.altKey : event.altKey) return false;

  return event.key.toLowerCase() === mainKey.toLowerCase();
}

type ClipboardEditable = {
  readOnly: boolean;
  getSelectedText: () => string;
  replaceSelection: (text: string) => void;
};

function resolveClipboardEditable(target: HTMLElement): ClipboardEditable | null {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const input = target;
    return {
      readOnly: input.readOnly || input.disabled,
      getSelectedText: () => {
        const start = input.selectionStart ?? 0;
        const end = input.selectionEnd ?? start;
        return input.value.slice(start, end);
      },
      replaceSelection: (text) => {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const nextValue = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
        input.value = nextValue;
        input.setSelectionRange(start + text.length, start + text.length);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
    };
  }

  const contentEditable = target.closest('[contenteditable="true"]') as HTMLElement | null;
  if (!contentEditable) {
    return null;
  }

  return {
    readOnly: false,
    getSelectedText: () => window.getSelection()?.toString() ?? '',
    replaceSelection: (text) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      contentEditable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    },
  };
}

function toRgbChannels(color: string) {
  const normalized = color.trim();

  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    const expanded = hex.length === 3
      ? hex.split('').map((char) => `${char}${char}`).join('')
      : hex;

    if (expanded.length === 6) {
      const red = Number.parseInt(expanded.slice(0, 2), 16);
      const green = Number.parseInt(expanded.slice(2, 4), 16);
      const blue = Number.parseInt(expanded.slice(4, 6), 16);

      return `${red} ${green} ${blue}`;
    }
  }

  const match = normalized.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const [red = '0', green = '0', blue = '0'] = match[1]
      .split(',')
      .map((part) => part.trim());

    return `${red} ${green} ${blue}`;
  }

  return '0 0 0';
}
