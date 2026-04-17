import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { createPortal } from 'react-dom';
import { Download, Settings2, SlidersHorizontal, FileJson, Upload, X } from 'lucide-react';
import AppSelect from '../../components/ui/AppSelect';
import { useUiPreferencesStore } from '../../store/uiPreferences';
import { useConnectionsStore } from '../../store/connections';
import { readSystemConfig, type SystemConfig } from '../../store/systemConfig';
import { APP_THEMES } from '../../themes';
import { APP_LOCALES, translate } from '../../i18n';
import { ensureMonacoThemes, resolveMonacoTheme } from '../../lib/monaco-theme';

type ConfigurationTab = 'form' | 'json';

export default function ConfigurationDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const showServerTimeInStatusBar = useUiPreferencesStore((state) => state.showServerTimeInStatusBar);
  const locale = useUiPreferencesStore((state) => state.locale);
  const resultPageSize = useUiPreferencesStore((state) => state.resultPageSize);
  const themeId = useUiPreferencesStore((state) => state.themeId);
  const density = useUiPreferencesStore((state) => state.density);
  const editorFontSize = useUiPreferencesStore((state) => state.editorFontSize);
  const sidebarWidth = useUiPreferencesStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useUiPreferencesStore((state) => state.sidebarCollapsed);
  const logsExpandedByDefault = useUiPreferencesStore((state) => state.logsExpandedByDefault);
  const commandPaletteShortcut = useUiPreferencesStore((state) => state.commandPaletteShortcut);
  const newQueryTabShortcut = useUiPreferencesStore((state) => state.newQueryTabShortcut);
  const closeQueryTabShortcut = useUiPreferencesStore((state) => state.closeQueryTabShortcut);
  const setSemanticBackgroundEnabled = useUiPreferencesStore((state) => state.setSemanticBackgroundEnabled);
  const setShowServerTimeInStatusBar = useUiPreferencesStore((state) => state.setShowServerTimeInStatusBar);
  const setLocale = useUiPreferencesStore((state) => state.setLocale);
  const setResultPageSize = useUiPreferencesStore((state) => state.setResultPageSize);
  const setThemeId = useUiPreferencesStore((state) => state.setThemeId);
  const setDensity = useUiPreferencesStore((state) => state.setDensity);
  const setEditorFontSize = useUiPreferencesStore((state) => state.setEditorFontSize);
  const setSidebarWidth = useUiPreferencesStore((state) => state.setSidebarWidth);
  const setSidebarCollapsed = useUiPreferencesStore((state) => state.setSidebarCollapsed);
  const setLogsExpandedByDefault = useUiPreferencesStore((state) => state.setLogsExpandedByDefault);
  const setCommandPaletteShortcut = useUiPreferencesStore((state) => state.setCommandPaletteShortcut);
  const setNewQueryTabShortcut = useUiPreferencesStore((state) => state.setNewQueryTabShortcut);
  const setCloseQueryTabShortcut = useUiPreferencesStore((state) => state.setCloseQueryTabShortcut);
  const connections = useConnectionsStore((state) => state.connections);
  const favoriteConnectionId = useConnectionsStore((state) => state.favoriteConnectionId);
  const setFavoriteConnection = useConnectionsStore((state) => state.setFavoriteConnection);

  const currentConfig = useMemo<SystemConfig>(
    () => ({
      version: 4,
      ui: {
        locale,
        semanticBackgroundEnabled,
        showServerTimeInStatusBar,
        resultPageSize,
        themeId,
        density,
        editorFontSize,
      },
      workbench: {
        sidebarWidth,
        sidebarCollapsed,
        logsExpandedByDefault,
      },
      shortcuts: {
        commandPalette: commandPaletteShortcut,
        newQueryTab: newQueryTabShortcut,
        closeQueryTab: closeQueryTabShortcut,
      },
      startup: {
        favoriteConnectionId,
      },
    }),
    [
      closeQueryTabShortcut,
      commandPaletteShortcut,
      density,
      editorFontSize,
      locale,
      favoriteConnectionId,
      logsExpandedByDefault,
      newQueryTabShortcut,
      resultPageSize,
      semanticBackgroundEnabled,
      showServerTimeInStatusBar,
      sidebarCollapsed,
      sidebarWidth,
      themeId,
    ],
  );

  const [activeTab, setActiveTab] = useState<ConfigurationTab>('form');
  const [draft, setDraft] = useState<SystemConfig>(currentConfig);
  const [jsonDraft, setJsonDraft] = useState(JSON.stringify(currentConfig, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(currentConfig);
    setJsonDraft(JSON.stringify(currentConfig, null, 2));
    setJsonError(null);
    setActiveTab('form');
  }, [currentConfig, open]);

  if (!open) {
    return null;
  }

  const applyConfig = (nextConfig: SystemConfig) => {
    const favoriteExists =
      nextConfig.startup.favoriteConnectionId == null ||
      connections.some((connection) => connection.id === nextConfig.startup.favoriteConnectionId);

    if (!favoriteExists) {
      throw new Error(translate(locale, 'favoriteConnectionJsonNotFound'));
    }

    setLocale(nextConfig.ui.locale);
    setSemanticBackgroundEnabled(nextConfig.ui.semanticBackgroundEnabled);
    setShowServerTimeInStatusBar(nextConfig.ui.showServerTimeInStatusBar);
    setResultPageSize(nextConfig.ui.resultPageSize);
    setThemeId(nextConfig.ui.themeId);
    setDensity(nextConfig.ui.density);
    setEditorFontSize(nextConfig.ui.editorFontSize);
    setSidebarWidth(nextConfig.workbench.sidebarWidth);
    setSidebarCollapsed(nextConfig.workbench.sidebarCollapsed);
    setLogsExpandedByDefault(nextConfig.workbench.logsExpandedByDefault);
    setCommandPaletteShortcut(nextConfig.shortcuts.commandPalette);
    setNewQueryTabShortcut(nextConfig.shortcuts.newQueryTab);
    setCloseQueryTabShortcut(nextConfig.shortcuts.closeQueryTab);
    setFavoriteConnection(nextConfig.startup.favoriteConnectionId);
  };

  const handleSaveForm = () => {
    applyConfig(draft);
    onClose();
  };

  const handleSaveJson = () => {
    try {
      const parsed = normalizeJsonConfig(JSON.parse(jsonDraft));
      applyConfig(parsed);
      setDraft(parsed);
      setJsonDraft(JSON.stringify(parsed, null, 2));
      setJsonError(null);
      onClose();
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : translate(locale, 'invalidJson'));
    }
  };

  const handleExport = () => {
    const contents = JSON.stringify(readSystemConfig(), null, 2);
    const blob = new Blob([contents], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'pulsesql-config.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File | null) => {
    if (!file) {
      return;
    }

    try {
      const imported = await file.text();
      const parsed = normalizeJsonConfig(JSON.parse(imported));
      applyConfig(parsed);
      setDraft(parsed);
      setJsonDraft(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : translate(locale, 'importJsonError'));
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-background/78 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-surface/95 shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <Settings2 size={16} />
              {translate(locale, 'configurationsTitle')}
            </div>
            <div className="text-xs text-muted">{translate(locale, 'configurationsSubtitle')}</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text">
              <Upload size={13} />
              <span>{translate(locale, 'import')}</span>
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(event) => {
                  void handleImport(event.target.files?.[0] ?? null);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
            >
              <Download size={13} />
              {translate(locale, 'export')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('form')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${
                activeTab === 'form'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted hover:bg-border/30 hover:text-text'
              }`}
            >
              <SlidersHorizontal size={13} />
              {translate(locale, 'visual')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('json')}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs ${
                activeTab === 'json'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted hover:bg-border/30 hover:text-text'
              }`}
            >
              <FileJson size={13} />
              {translate(locale, 'json')}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'form' ? (
            <div className="h-full overflow-auto p-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <section className="rounded-lg border border-border/70 bg-background/24 p-4">
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">{translate(locale, 'interfaceSection')}</div>
                  <div className="space-y-4">
                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'language')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'configurationsSubtitle')}</div>
                      <AppSelect
                        value={draft.ui.locale}
                        onChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              locale: value === 'en-US' ? 'en-US' : 'pt-BR',
                            },
                          }))
                        }
                        options={APP_LOCALES.map((appLocale) => ({
                          value: appLocale.value,
                          label: appLocale.label,
                        }))}
                        className="w-full"
                      />
                    </label>

                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'theme')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'themeDescription')}</div>
                      <AppSelect
                        value={draft.ui.themeId}
                        onChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              themeId: value,
                            },
                          }))
                        }
                        options={APP_THEMES.map((theme) => ({
                          value: theme.id,
                          label: theme.label,
                        }))}
                        className="w-full"
                      />
                    </label>

                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'density')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'densityDescription')}</div>
                      <AppSelect
                        value={draft.ui.density}
                        onChange={(value) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              density: value === 'compact' ? 'compact' : 'comfortable',
                            },
                          }))
                        }
                        options={[
                          { value: 'comfortable', label: translate(locale, 'densityComfortable') },
                          { value: 'compact', label: translate(locale, 'densityCompact') },
                        ]}
                        className="w-full"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div>
                        <div className="text-sm text-text">{translate(locale, 'semanticBackground')}</div>
                        <div className="text-xs text-muted">{translate(locale, 'semanticBackgroundDescription')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.ui.semanticBackgroundEnabled}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              semanticBackgroundEnabled: event.target.checked,
                            },
                          }))
                        }
                        className="accent-primary"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div>
                        <div className="text-sm text-text">{translate(locale, 'showServerTimeInStatusBar')}</div>
                        <div className="text-xs text-muted">{translate(locale, 'showServerTimeInStatusBarDescription')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.ui.showServerTimeInStatusBar}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              showServerTimeInStatusBar: event.target.checked,
                            },
                          }))
                        }
                        className="accent-primary"
                      />
                    </label>

                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'rowsPerPage')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'rowsPerPageDescription')}</div>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={draft.ui.resultPageSize}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              resultPageSize: normalizePageSize(Number(event.target.value)),
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                      />
                    </label>

                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'editorFontSize')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'editorFontSizeDescription')}</div>
                      <input
                        type="number"
                        min={11}
                        max={20}
                        value={draft.ui.editorFontSize}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              editorFontSize: normalizeEditorFontSize(Number(event.target.value)),
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 bg-background/24 p-4">
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">{translate(locale, 'workbench')}</div>
                  <div className="space-y-4">
                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'sidebarWidth')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'sidebarWidthDescription')}</div>
                      <input
                        type="number"
                        min={220}
                        max={520}
                        value={draft.workbench.sidebarWidth}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            workbench: {
                              ...current.workbench,
                              sidebarWidth: normalizeSidebarWidth(Number(event.target.value)),
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div>
                        <div className="text-sm text-text">{translate(locale, 'sidebarCollapsedOnStartup')}</div>
                        <div className="text-xs text-muted">{translate(locale, 'sidebarCollapsedOnStartupDescription')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.workbench.sidebarCollapsed}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            workbench: {
                              ...current.workbench,
                              sidebarCollapsed: event.target.checked,
                            },
                          }))
                        }
                        className="accent-primary"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div>
                        <div className="text-sm text-text">{translate(locale, 'logsExpandedByDefault')}</div>
                        <div className="text-xs text-muted">{translate(locale, 'logsExpandedByDefaultDescription')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.workbench.logsExpandedByDefault}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            workbench: {
                              ...current.workbench,
                              logsExpandedByDefault: event.target.checked,
                            },
                          }))
                        }
                        className="accent-primary"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 bg-background/24 p-4">
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">{translate(locale, 'globalShortcuts')}</div>
                  <div className="space-y-4">
                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'commandPaletteLabel')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'shortcutExampleCommandPalette')}</div>
                      <input
                        value={draft.shortcuts.commandPalette}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            shortcuts: {
                              ...current.shortcuts,
                              commandPalette: event.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                      />
                    </label>

                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'newQueryTabLabel')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'shortcutExampleNewQueryTab')}</div>
                      <input
                        value={draft.shortcuts.newQueryTab}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            shortcuts: {
                              ...current.shortcuts,
                              newQueryTab: event.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                      />
                    </label>

                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">{translate(locale, 'closeQueryTabLabel')}</div>
                      <div className="mb-2 text-xs text-muted">{translate(locale, 'shortcutExampleCloseQueryTab')}</div>
                      <input
                        value={draft.shortcuts.closeQueryTab}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            shortcuts: {
                              ...current.shortcuts,
                              closeQueryTab: event.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 bg-background/24 p-4">
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">{translate(locale, 'startup')}</div>
                  <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                    <div className="text-sm text-text">{translate(locale, 'favoriteConnection')}</div>
                    <div className="mb-2 text-xs text-muted">{translate(locale, 'favoriteConnectionDescription')}</div>
                    <AppSelect
                      value={draft.startup.favoriteConnectionId ?? ''}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          startup: {
                            ...current.startup,
                            favoriteConnectionId: value || null,
                          },
                        }))
                      }
                      options={[
                        { value: '', label: translate(locale, 'none') },
                        ...connections.map((connection) => ({
                          value: connection.id,
                          label: connection.name,
                        })),
                      ]}
                      className="w-full"
                    />
                  </label>
                </section>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-border/60 px-5 py-3 text-xs text-muted">
                {translate(locale, 'editJsonDirectly')}
              </div>
              <div className="min-h-0 flex-1">
                <Editor
                  height="100%"
                  language="json"
                  theme={resolveMonacoTheme(themeId)}
                  value={jsonDraft}
                  onChange={(value) => setJsonDraft(value ?? '')}
                  beforeMount={(monaco) => {
                    ensureMonacoThemes(monaco);
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
                    scrollBeyondLastLine: false,
                    formatOnPaste: true,
                    formatOnType: true,
                  }}
                />
              </div>
              {jsonError ? (
                <div className="border-t border-red-400/20 bg-red-400/8 px-5 py-3 text-sm text-red-300">
                  {jsonError}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
          >
            {translate(locale, 'cancel')}
          </button>
          <button
            type="button"
            onClick={activeTab === 'form' ? handleSaveForm : handleSaveJson}
            className="rounded-lg border border-primary/40 bg-primary/12 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/18"
          >
            {translate(locale, 'save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function normalizeJsonConfig(input: unknown): SystemConfig {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const ui = raw.ui && typeof raw.ui === 'object' ? (raw.ui as Record<string, unknown>) : {};
  const workbench =
    raw.workbench && typeof raw.workbench === 'object' ? (raw.workbench as Record<string, unknown>) : {};
  const shortcuts =
    raw.shortcuts && typeof raw.shortcuts === 'object' ? (raw.shortcuts as Record<string, unknown>) : {};
  const startup =
    raw.startup && typeof raw.startup === 'object' ? (raw.startup as Record<string, unknown>) : {};

  return {
    version: 4,
    ui: {
      locale: ui.locale === 'en-US' ? 'en-US' : 'pt-BR',
      semanticBackgroundEnabled: ui.semanticBackgroundEnabled !== false,
      showServerTimeInStatusBar: ui.showServerTimeInStatusBar === true,
      resultPageSize: normalizePageSize(ui.resultPageSize),
      themeId: normalizeThemeId(ui.themeId),
      density: normalizeDensity(ui.density),
      editorFontSize: normalizeEditorFontSize(ui.editorFontSize),
    },
    workbench: {
      sidebarWidth: normalizeSidebarWidth(workbench.sidebarWidth),
      sidebarCollapsed: workbench.sidebarCollapsed === true,
      logsExpandedByDefault: workbench.logsExpandedByDefault === true,
    },
    shortcuts: {
      commandPalette: normalizeShortcut(shortcuts.commandPalette, 'CmdOrCtrl+Shift+P'),
      newQueryTab: normalizeShortcut(shortcuts.newQueryTab, 'CmdOrCtrl+Alt+N'),
      closeQueryTab: normalizeShortcut(shortcuts.closeQueryTab, 'CmdOrCtrl+W'),
    },
    startup: {
      favoriteConnectionId:
        typeof startup.favoriteConnectionId === 'string' && startup.favoriteConnectionId.trim().length > 0
          ? startup.favoriteConnectionId
          : null,
    },
  };
}

function normalizePageSize(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1000, Math.max(1, Math.round(value)));
  }

  return 100;
}

function normalizeThemeId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : 'pulsesql-dark';
}

function normalizeDensity(value: unknown): 'compact' | 'comfortable' {
  return value === 'compact' ? 'compact' : 'comfortable';
}

function normalizeEditorFontSize(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(20, Math.max(11, Math.round(value)));
  }

  return 14;
}

function normalizeSidebarWidth(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(520, Math.max(220, Math.round(value)));
  }

  return 290;
}

function normalizeShortcut(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}
