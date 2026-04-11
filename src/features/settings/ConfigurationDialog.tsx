import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { createPortal } from 'react-dom';
import { Download, Settings2, SlidersHorizontal, FileJson, Upload, X } from 'lucide-react';
import { useUiPreferencesStore } from '../../store/uiPreferences';
import { useConnectionsStore } from '../../store/connections';
import { readSystemConfig, type SystemConfig } from '../../store/systemConfig';
import { APP_THEMES } from '../../themes';

type ConfigurationTab = 'form' | 'json';

export default function ConfigurationDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const resultPageSize = useUiPreferencesStore((state) => state.resultPageSize);
  const themeId = useUiPreferencesStore((state) => state.themeId);
  const density = useUiPreferencesStore((state) => state.density);
  const editorFontSize = useUiPreferencesStore((state) => state.editorFontSize);
  const sidebarWidth = useUiPreferencesStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useUiPreferencesStore((state) => state.sidebarCollapsed);
  const logsExpandedByDefault = useUiPreferencesStore((state) => state.logsExpandedByDefault);
  const commandPaletteShortcut = useUiPreferencesStore((state) => state.commandPaletteShortcut);
  const newQueryTabShortcut = useUiPreferencesStore((state) => state.newQueryTabShortcut);
  const setSemanticBackgroundEnabled = useUiPreferencesStore((state) => state.setSemanticBackgroundEnabled);
  const setResultPageSize = useUiPreferencesStore((state) => state.setResultPageSize);
  const setThemeId = useUiPreferencesStore((state) => state.setThemeId);
  const setDensity = useUiPreferencesStore((state) => state.setDensity);
  const setEditorFontSize = useUiPreferencesStore((state) => state.setEditorFontSize);
  const setSidebarWidth = useUiPreferencesStore((state) => state.setSidebarWidth);
  const setSidebarCollapsed = useUiPreferencesStore((state) => state.setSidebarCollapsed);
  const setLogsExpandedByDefault = useUiPreferencesStore((state) => state.setLogsExpandedByDefault);
  const setCommandPaletteShortcut = useUiPreferencesStore((state) => state.setCommandPaletteShortcut);
  const setNewQueryTabShortcut = useUiPreferencesStore((state) => state.setNewQueryTabShortcut);
  const connections = useConnectionsStore((state) => state.connections);
  const favoriteConnectionId = useConnectionsStore((state) => state.favoriteConnectionId);
  const setFavoriteConnection = useConnectionsStore((state) => state.setFavoriteConnection);

  const currentConfig = useMemo<SystemConfig>(
    () => ({
      version: 2,
      ui: {
        semanticBackgroundEnabled,
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
      },
      startup: {
        favoriteConnectionId,
      },
    }),
    [
      commandPaletteShortcut,
      density,
      editorFontSize,
      favoriteConnectionId,
      logsExpandedByDefault,
      newQueryTabShortcut,
      resultPageSize,
      semanticBackgroundEnabled,
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
      throw new Error('A conexao favorita informada no JSON nao existe.');
    }

    setSemanticBackgroundEnabled(nextConfig.ui.semanticBackgroundEnabled);
    setResultPageSize(nextConfig.ui.resultPageSize);
    setThemeId(nextConfig.ui.themeId);
    setDensity(nextConfig.ui.density);
    setEditorFontSize(nextConfig.ui.editorFontSize);
    setSidebarWidth(nextConfig.workbench.sidebarWidth);
    setSidebarCollapsed(nextConfig.workbench.sidebarCollapsed);
    setLogsExpandedByDefault(nextConfig.workbench.logsExpandedByDefault);
    setCommandPaletteShortcut(nextConfig.shortcuts.commandPalette);
    setNewQueryTabShortcut(nextConfig.shortcuts.newQueryTab);
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
      setJsonError(error instanceof Error ? error.message : 'JSON invalido.');
    }
  };

  const handleExport = () => {
    const contents = JSON.stringify(readSystemConfig(), null, 2);
    const blob = new Blob([contents], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'blacktable-config.json';
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
      setJsonError(error instanceof Error ? error.message : 'Falha ao importar o JSON.');
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
              Configuration
            </div>
            <div className="text-xs text-muted">Edite as configuracoes do sistema por formulario ou JSON.</div>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text">
              <Upload size={13} />
              <span>Import</span>
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
              Export
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
              Visual
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
              JSON
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'form' ? (
            <div className="h-full overflow-auto p-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <section className="rounded-lg border border-border/70 bg-background/24 p-4">
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">Interface</div>
                  <div className="space-y-4">
                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">Tema</div>
                      <div className="mb-2 text-xs text-muted">Escolha o visual base do app.</div>
                      <select
                        value={draft.ui.themeId}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              themeId: event.target.value,
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                      >
                        {APP_THEMES.map((theme) => (
                          <option key={theme.id} value={theme.id}>
                            {theme.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">Densidade</div>
                      <div className="mb-2 text-xs text-muted">Ajusta o espacamento visual do workbench.</div>
                      <select
                        value={draft.ui.density}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            ui: {
                              ...current.ui,
                              density: event.target.value === 'compact' ? 'compact' : 'comfortable',
                            },
                          }))
                        }
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                      >
                        <option value="comfortable">Comfortable</option>
                        <option value="compact">Compact</option>
                      </select>
                    </label>

                    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div>
                        <div className="text-sm text-text">Semantic Background</div>
                        <div className="text-xs text-muted">Ativa o fundo semantico da workspace.</div>
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

                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">Rows por pagina</div>
                      <div className="mb-2 text-xs text-muted">Tamanho padrao das paginas no result grid.</div>
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
                      <div className="text-sm text-text">Fonte do editor</div>
                      <div className="mb-2 text-xs text-muted">Tamanho base do texto no editor SQL.</div>
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
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">Workbench</div>
                  <div className="space-y-4">
                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">Largura da sidebar</div>
                      <div className="mb-2 text-xs text-muted">Valor padrao da lateral de conexoes.</div>
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
                        <div className="text-sm text-text">Iniciar com sidebar recolhida</div>
                        <div className="text-xs text-muted">Aplica na abertura do app.</div>
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
                        <div className="text-sm text-text">Logs expandidos por padrao</div>
                        <div className="text-xs text-muted">Vale para conexoes sem preferencia local salva.</div>
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
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">Atalhos globais</div>
                  <div className="space-y-4">
                    <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                      <div className="text-sm text-text">Command palette</div>
                      <div className="mb-2 text-xs text-muted">Exemplo: CmdOrCtrl+Shift+P</div>
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
                      <div className="text-sm text-text">Nova aba de query</div>
                      <div className="mb-2 text-xs text-muted">Exemplo: CmdOrCtrl+Alt+N</div>
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
                  </div>
                </section>

                <section className="rounded-lg border border-border/70 bg-background/24 p-4">
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-muted">Startup</div>
                  <label className="block rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                    <div className="text-sm text-text">Conexao favorita</div>
                    <div className="mb-2 text-xs text-muted">Conexao aberta automaticamente na inicializacao.</div>
                    <select
                      value={draft.startup.favoriteConnectionId ?? ''}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          startup: {
                            ...current.startup,
                            favoriteConnectionId: event.target.value || null,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                    >
                      <option value="">Nenhuma</option>
                      {connections.map((connection) => (
                        <option key={connection.id} value={connection.id}>
                          {connection.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-border/60 px-5 py-3 text-xs text-muted">
                Edite o JSON diretamente. Campos invalidos serao rejeitados ao salvar.
              </div>
              <div className="min-h-0 flex-1">
                <Editor
                  height="100%"
                  language="json"
                  theme="vs-dark"
                  value={jsonDraft}
                  onChange={(value) => setJsonDraft(value ?? '')}
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
            Cancelar
          </button>
          <button
            type="button"
            onClick={activeTab === 'form' ? handleSaveForm : handleSaveJson}
            className="rounded-lg border border-primary/40 bg-primary/12 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/18"
          >
            Salvar
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
    version: 2,
    ui: {
      semanticBackgroundEnabled: ui.semanticBackgroundEnabled !== false,
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
  return typeof value === 'string' && value.trim().length > 0 ? value : 'blacktable-dark';
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
