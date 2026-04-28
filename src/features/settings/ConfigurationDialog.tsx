import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { createPortal } from 'react-dom';
import { Command, Download, FileJson, Grid2x2, Palette, PenLine, Search, Settings2, SlidersHorizontal, Upload, X, Zap } from 'lucide-react';
import AppSelect from '../../components/ui/AppSelect';
import { useUiPreferencesStore } from '../../store/uiPreferences';
import { useConnectionsStore, getConnectionColor, hexToRgba } from '../../store/connections';
import { readSystemConfig, type SystemConfig } from '../../store/systemConfig';
import { APP_THEMES } from '../../themes';
import { APP_LOCALES, translate } from '../../i18n';
import { ensureConfiguredMonacoTheme, resolveConfiguredMonacoTheme } from '../../lib/monaco-theme';

type ConfigurationTab = 'form' | 'json';
type ConfigSection = 'interface' | 'editor' | 'workbench' | 'shortcuts' | 'startup' | 'advanced';

const CONFIG_SECTION_KEY = 'pulsesql.config.lastSection';

const MONACO_THEME_OPTIONS = [
  { value: 'auto', label: 'Auto (from app theme)' },
  { value: 'default', label: 'Default' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'solarized-dark', label: 'Solarized Dark' },
  { value: 'github-dark', label: 'GitHub Dark' },
];

export default function ConfigurationDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const semanticBackgroundEnabled = useUiPreferencesStore((state) => state.semanticBackgroundEnabled);
  const showServerTimeInStatusBar = useUiPreferencesStore((state) => state.showServerTimeInStatusBar);
  const showAutocommitInStatusBar = useUiPreferencesStore((state) => state.showAutocommitInStatusBar);
  const locale = useUiPreferencesStore((state) => state.locale);
  const resultPageSize = useUiPreferencesStore((state) => state.resultPageSize);
  const themeId = useUiPreferencesStore((state) => state.themeId);
  const monacoThemeName = useUiPreferencesStore((state) => state.monacoThemeName);
  const density = useUiPreferencesStore((state) => state.density);
  const editorFontSize = useUiPreferencesStore((state) => state.editorFontSize);
  const formatOnSave = useUiPreferencesStore((state) => state.formatOnSave);
  const autoCloseBrackets = useUiPreferencesStore((state) => state.autoCloseBrackets);
  const sidebarWidth = useUiPreferencesStore((state) => state.sidebarWidth);
  const sidebarCollapsed = useUiPreferencesStore((state) => state.sidebarCollapsed);
  const logsExpandedByDefault = useUiPreferencesStore((state) => state.logsExpandedByDefault);
  const commandPaletteShortcut = useUiPreferencesStore((state) => state.commandPaletteShortcut);
  const newQueryTabShortcut = useUiPreferencesStore((state) => state.newQueryTabShortcut);
  const closeQueryTabShortcut = useUiPreferencesStore((state) => state.closeQueryTabShortcut);
  const setSemanticBackgroundEnabled = useUiPreferencesStore((state) => state.setSemanticBackgroundEnabled);
  const setShowServerTimeInStatusBar = useUiPreferencesStore((state) => state.setShowServerTimeInStatusBar);
  const setShowAutocommitInStatusBar = useUiPreferencesStore((state) => state.setShowAutocommitInStatusBar);
  const setLocale = useUiPreferencesStore((state) => state.setLocale);
  const setResultPageSize = useUiPreferencesStore((state) => state.setResultPageSize);
  const setThemeId = useUiPreferencesStore((state) => state.setThemeId);
  const setMonacoThemeName = useUiPreferencesStore((state) => state.setMonacoThemeName);
  const setDensity = useUiPreferencesStore((state) => state.setDensity);
  const setEditorFontSize = useUiPreferencesStore((state) => state.setEditorFontSize);
  const setFormatOnSave = useUiPreferencesStore((state) => state.setFormatOnSave);
  const setAutoCloseBrackets = useUiPreferencesStore((state) => state.setAutoCloseBrackets);
  const setSidebarWidth = useUiPreferencesStore((state) => state.setSidebarWidth);
  const setSidebarCollapsed = useUiPreferencesStore((state) => state.setSidebarCollapsed);
  const setLogsExpandedByDefault = useUiPreferencesStore((state) => state.setLogsExpandedByDefault);
  const setCommandPaletteShortcut = useUiPreferencesStore((state) => state.setCommandPaletteShortcut);
  const setNewQueryTabShortcut = useUiPreferencesStore((state) => state.setNewQueryTabShortcut);
  const setCloseQueryTabShortcut = useUiPreferencesStore((state) => state.setCloseQueryTabShortcut);
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnectionId = useConnectionsStore((state) => state.activeConnectionId);
  const favoriteConnectionId = useConnectionsStore((state) => state.favoriteConnectionId);
  const setFavoriteConnection = useConnectionsStore((state) => state.setFavoriteConnection);

  const cc = getConnectionColor(connections, activeConnectionId);
  const ccBg = hexToRgba(cc, 0.12);
  const ccBorder = hexToRgba(cc, 0.35);

  const currentConfig = useMemo<SystemConfig>(
    () => ({
      version: 4,
      ui: {
        locale,
        semanticBackgroundEnabled,
        showServerTimeInStatusBar,
        showAutocommitInStatusBar,
        resultPageSize,
        themeId,
        monacoThemeName,
        density,
        editorFontSize,
        formatOnSave,
        autoCloseBrackets,
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
      formatOnSave,
      autoCloseBrackets,
      locale,
      monacoThemeName,
      favoriteConnectionId,
      logsExpandedByDefault,
      newQueryTabShortcut,
      resultPageSize,
      semanticBackgroundEnabled,
      showServerTimeInStatusBar,
      showAutocommitInStatusBar,
      sidebarCollapsed,
      sidebarWidth,
      themeId,
    ],
  );

  const [activeTab, setActiveTab] = useState<ConfigurationTab>('form');
  const [activeSection, setActiveSection] = useState<ConfigSection>(() => {
    try {
      const saved = localStorage.getItem(CONFIG_SECTION_KEY);
      if (saved === 'interface' || saved === 'editor' || saved === 'workbench' ||
          saved === 'shortcuts' || saved === 'startup' || saved === 'advanced') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'interface';
  });
  const [draft, setDraft] = useState<SystemConfig>(currentConfig);
  const [jsonDraft, setJsonDraft] = useState(JSON.stringify(currentConfig, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(currentConfig);
    setJsonDraft(JSON.stringify(currentConfig, null, 2));
    setJsonError(null);
    setActiveTab('form');
    setSearchQuery('');
    setDebouncedSearch('');
  }, [currentConfig, open]);

  useEffect(() => {
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 200);
    return () => {
      if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  if (!open) {
    return null;
  }

  const handleSectionChange = (section: ConfigSection) => {
    setActiveSection(section);
    try {
      localStorage.setItem(CONFIG_SECTION_KEY, section);
    } catch {
      // ignore
    }
  };

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
    setShowAutocommitInStatusBar(nextConfig.ui.showAutocommitInStatusBar);
    setResultPageSize(nextConfig.ui.resultPageSize);
    setThemeId(nextConfig.ui.themeId);
    setMonacoThemeName(nextConfig.ui.monacoThemeName);
    setDensity(nextConfig.ui.density);
    setEditorFontSize(nextConfig.ui.editorFontSize);
    setFormatOnSave(nextConfig.ui.formatOnSave);
    setAutoCloseBrackets(nextConfig.ui.autoCloseBrackets);
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

  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  const navItems: Array<{ id: ConfigSection; label: string; Icon: React.ElementType }> = [
    { id: 'interface', label: t('interfaceSection'), Icon: Palette },
    { id: 'editor', label: t('editorSection'), Icon: PenLine },
    { id: 'workbench', label: t('workbench'), Icon: Grid2x2 },
    { id: 'shortcuts', label: t('globalShortcuts'), Icon: Command },
    { id: 'startup', label: t('startup'), Icon: Zap },
    { id: 'advanced', label: t('advancedSection'), Icon: SlidersHorizontal },
  ];

  // All settings rows with their section, label, and description for search filtering
  type SettingRow = { section: ConfigSection; label: string; description: string; key: string };
  const allSettingRows: SettingRow[] = [
    { section: 'interface', label: t('language'), description: t('languageDescription'), key: 'language' },
    { section: 'interface', label: t('theme'), description: t('themeDescription'), key: 'theme' },
    { section: 'interface', label: t('density'), description: t('densityDescription'), key: 'density' },
    { section: 'interface', label: t('semanticBackground'), description: t('semanticBackgroundDescription'), key: 'semanticBackground' },
    { section: 'interface', label: t('showServerTimeInStatusBar'), description: t('showServerTimeInStatusBarDescription'), key: 'showServerTime' },
    { section: 'interface', label: t('showAutocommitInStatusBar'), description: t('showAutocommitInStatusBarDescription'), key: 'showAutocommit' },
    { section: 'editor', label: t('monacoThemeName'), description: t('monacoThemeNameDescription'), key: 'monacoTheme' },
    { section: 'editor', label: t('editorFontSize'), description: t('editorFontSizeDescription'), key: 'editorFontSize' },
    { section: 'editor', label: t('rowsPerPage'), description: t('rowsPerPageDescription'), key: 'rowsPerPage' },
    { section: 'editor', label: t('formatOnSave'), description: t('formatOnSaveDescription'), key: 'formatOnSave' },
    { section: 'editor', label: t('autoCloseBrackets'), description: t('autoCloseBracketsDescription'), key: 'autoCloseBrackets' },
    { section: 'workbench', label: t('sidebarWidth'), description: t('sidebarWidthDescription'), key: 'sidebarWidth' },
    { section: 'workbench', label: t('sidebarCollapsedOnStartup'), description: t('sidebarCollapsedOnStartupDescription'), key: 'sidebarCollapsed' },
    { section: 'workbench', label: t('logsExpandedByDefault'), description: t('logsExpandedByDefaultDescription'), key: 'logsExpanded' },
    { section: 'shortcuts', label: t('commandPaletteLabel'), description: t('shortcutExampleCommandPalette'), key: 'commandPalette' },
    { section: 'shortcuts', label: t('newQueryTabLabel'), description: t('shortcutExampleNewQueryTab'), key: 'newQueryTab' },
    { section: 'shortcuts', label: t('closeQueryTabLabel'), description: t('shortcutExampleCloseQueryTab'), key: 'closeQueryTab' },
    { section: 'startup', label: t('favoriteConnection'), description: t('favoriteConnectionDescription'), key: 'favoriteConnection' },
  ];

  const q = debouncedSearch.trim().toLowerCase();
  const matchingKeys = q
    ? new Set(allSettingRows.filter(r => r.label.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)).map(r => r.key))
    : null;

  const shouldShow = (key: string) => !matchingKeys || matchingKeys.has(key);

  return createPortal(
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center bg-background/78 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="flex h-[82vh] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-surface/95 shadow-[0_32px_120px_rgba(0,0,0,0.52)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: ccBg, border: `1px solid ${ccBorder}` }}>
              <Settings2 size={16} style={{ color: cc }} />
            </div>
            <div>
              <div className="text-sm font-semibold text-text">{t('configurationsTitle')}</div>
              <div className="text-xs text-muted">{t('configurationsSubtitle')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text">
              <Upload size={13} />
              <span>{t('import')}</span>
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
              {t('export')}
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

        {/* Tab bar */}
        <div className="border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            {([
              { id: 'form', Icon: SlidersHorizontal, label: t('visual') },
              { id: 'json', Icon: FileJson, label: t('json') },
            ] as const).map(({ id, Icon, label }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                    active ? '' : 'border-border text-muted hover:bg-border/30 hover:text-text'
                  }`}
                  style={active ? { borderColor: ccBorder, background: ccBg, color: cc } : undefined}
                >
                  <Icon size={13} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === 'form' ? (
            <div className="flex h-full flex-col">
              {/* Search bar — full width above sidebar + content */}
              <div className="border-b border-border/50 px-4 py-2.5">
                <div className="relative">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/50 pointer-events-none" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search settings…"
                    className="w-full rounded-lg border border-border/50 bg-background/30 py-2 pl-8 pr-8 text-xs text-text placeholder:text-muted/40 outline-none focus:border-primary/40 focus:bg-background/50"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted/50 hover:text-text"
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="flex min-h-0 flex-1">
              {/* Left nav sidebar */}
              <div className="w-44 shrink-0 border-r border-border/60 overflow-y-auto py-3 px-2">
                <nav className="space-y-0.5">
                  {navItems.map((item) => {
                    const active = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSectionChange(item.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-medium transition-colors ${
                          active
                            ? 'bg-background/60 text-text shadow-sm'
                            : 'text-muted hover:bg-background/30 hover:text-text'
                        }`}
                      >
                        <item.Icon
                          size={13}
                          className="shrink-0"
                          style={{ color: active ? cc : undefined }}
                        />
                        {item.label}
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Section content */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-auto p-5">
                  {q && matchingKeys && matchingKeys.size === 0 ? (
                    <div className="flex items-center justify-center py-12 text-sm text-muted/60">
                      No settings match "{q}"
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {/* Interface section */}
                      {(!q || ['language','theme','density','semanticBackground','showServerTime','showAutocommit'].some(k => matchingKeys?.has(k))) && activeSection === 'interface' ? (
                        <SectionBlock title={t('interfaceSection')}>
                          {shouldShow('language') && (
                            <SettingRow label={t('language')} description={t('languageDescription')}>
                              <AppSelect
                                value={draft.ui.locale}
                                onChange={(value) =>
                                  setDraft((current) => ({
                                    ...current,
                                    ui: { ...current.ui, locale: value === 'en-US' ? 'en-US' : 'pt-BR' },
                                  }))
                                }
                                options={APP_LOCALES.map((appLocale) => ({
                                  value: appLocale.value,
                                  label: appLocale.label,
                                }))}
                                className="w-full"
                              />
                            </SettingRow>
                          )}
                          {shouldShow('theme') && (
                            <SettingRow label={t('theme')} description={t('themeDescription')}>
                              <AppSelect
                                value={draft.ui.themeId}
                                onChange={(value) =>
                                  setDraft((current) => ({
                                    ...current,
                                    ui: { ...current.ui, themeId: value },
                                  }))
                                }
                                options={APP_THEMES.map((theme) => ({
                                  value: theme.id,
                                  label: theme.label,
                                }))}
                                className="w-full"
                              />
                            </SettingRow>
                          )}
                          {shouldShow('density') && (
                            <SettingRow label={t('density')} description={t('densityDescription')}>
                              <DensitySegmentedControl
                                value={draft.ui.density}
                                onChange={(value) =>
                                  setDraft((current) => ({
                                    ...current,
                                    ui: { ...current.ui, density: value },
                                  }))
                                }
                                options={[
                                  { value: 'compact', label: t('densityCompact') },
                                  { value: 'comfortable', label: t('densityComfortable') },
                                  { value: 'spacious', label: t('densitySpacious') },
                                ]}
                              />
                            </SettingRow>
                          )}
                          {/* Status Bar sub-section */}
                          {(shouldShow('semanticBackground') || shouldShow('showServerTime') || shouldShow('showAutocommit')) && (
                            <div className="mt-2 border-t border-border/40 pt-3">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/50">
                                {t('statusBarSection')}
                              </div>
                              <div className="divide-y divide-border/30">
                                {shouldShow('semanticBackground') && (
                                  <ToggleRow
                                    label={t('semanticBackground')}
                                    description={t('semanticBackgroundDescription')}
                                    checked={draft.ui.semanticBackgroundEnabled}
                                    color={cc}
                                    onChange={(checked) =>
                                      setDraft((current) => ({
                                        ...current,
                                        ui: { ...current.ui, semanticBackgroundEnabled: checked },
                                      }))
                                    }
                                  />
                                )}
                                {shouldShow('showServerTime') && (
                                  <ToggleRow
                                    label={t('showServerTimeInStatusBar')}
                                    description={t('showServerTimeInStatusBarDescription')}
                                    checked={draft.ui.showServerTimeInStatusBar}
                                    color={cc}
                                    onChange={(checked) =>
                                      setDraft((current) => ({
                                        ...current,
                                        ui: { ...current.ui, showServerTimeInStatusBar: checked },
                                      }))
                                    }
                                  />
                                )}
                                {shouldShow('showAutocommit') && (
                                  <ToggleRow
                                    label={t('showAutocommitInStatusBar')}
                                    description={t('showAutocommitInStatusBarDescription')}
                                    checked={draft.ui.showAutocommitInStatusBar}
                                    color={cc}
                                    onChange={(checked) =>
                                      setDraft((current) => ({
                                        ...current,
                                        ui: { ...current.ui, showAutocommitInStatusBar: checked },
                                      }))
                                    }
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </SectionBlock>
                      ) : null}

                      {/* Editor section */}
                      {(!q || ['monacoTheme','editorFontSize','rowsPerPage','formatOnSave','autoCloseBrackets'].some(k => matchingKeys?.has(k))) && activeSection === 'editor' ? (
                        <SectionBlock title={t('editorSection')}>
                          {/* EDITOR sub-header */}
                          {(shouldShow('monacoTheme') || shouldShow('editorFontSize') || shouldShow('rowsPerPage')) && (
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/50">
                              {t('editorSection')}
                            </div>
                          )}
                          {shouldShow('monacoTheme') && (
                            <SettingRow label={t('monacoThemeName')} description={t('monacoThemeNameDescription')}>
                              <AppSelect
                                value={draft.ui.monacoThemeName}
                                onChange={(value) =>
                                  setDraft((current) => ({
                                    ...current,
                                    ui: { ...current.ui, monacoThemeName: value },
                                  }))
                                }
                                options={MONACO_THEME_OPTIONS}
                                className="w-full"
                              />
                            </SettingRow>
                          )}
                          {shouldShow('editorFontSize') && (
                            <SettingRow label={t('editorFontSize')} description={t('editorFontSizeDescription')}>
                              <input
                                type="number"
                                min={11}
                                max={20}
                                value={draft.ui.editorFontSize}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    ui: { ...current.ui, editorFontSize: normalizeEditorFontSize(Number(event.target.value)) },
                                  }))
                                }
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                              />
                            </SettingRow>
                          )}
                          {shouldShow('rowsPerPage') && (
                            <SettingRow label={t('rowsPerPage')} description={t('rowsPerPageDescription')}>
                              <input
                                type="number"
                                min={1}
                                max={1000}
                                value={draft.ui.resultPageSize}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    ui: { ...current.ui, resultPageSize: normalizePageSize(Number(event.target.value)) },
                                  }))
                                }
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                              />
                            </SettingRow>
                          )}
                          {/* BEHAVIOR sub-header */}
                          {(shouldShow('formatOnSave') || shouldShow('autoCloseBrackets')) && (
                            <div className="mt-2 border-t border-border/40 pt-3">
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted/50">
                                {t('behaviorSection')}
                              </div>
                              <div className="divide-y divide-border/30">
                                {shouldShow('formatOnSave') && (
                                  <ToggleRow
                                    label={t('formatOnSave')}
                                    description={t('formatOnSaveDescription')}
                                    checked={draft.ui.formatOnSave}
                                    color={cc}
                                    onChange={(checked) =>
                                      setDraft((current) => ({
                                        ...current,
                                        ui: { ...current.ui, formatOnSave: checked },
                                      }))
                                    }
                                    badge="NEW"
                                  />
                                )}
                                {shouldShow('autoCloseBrackets') && (
                                  <ToggleRow
                                    label={t('autoCloseBrackets')}
                                    description={t('autoCloseBracketsDescription')}
                                    checked={draft.ui.autoCloseBrackets}
                                    color={cc}
                                    onChange={(checked) =>
                                      setDraft((current) => ({
                                        ...current,
                                        ui: { ...current.ui, autoCloseBrackets: checked },
                                      }))
                                    }
                                  />
                                )}
                              </div>
                            </div>
                          )}
                        </SectionBlock>
                      ) : null}

                      {/* Workbench section */}
                      {(!q || ['sidebarWidth','sidebarCollapsed','logsExpanded'].some(k => matchingKeys?.has(k))) && activeSection === 'workbench' ? (
                        <SectionBlock title={t('workbench')}>
                          {shouldShow('sidebarWidth') && (
                            <SettingRow label={t('sidebarWidth')} description={t('sidebarWidthDescription')}>
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
                            </SettingRow>
                          )}
                          {shouldShow('sidebarCollapsed') && (
                            <ToggleRow
                              label={t('sidebarCollapsedOnStartup')}
                              description={t('sidebarCollapsedOnStartupDescription')}
                              checked={draft.workbench.sidebarCollapsed}
                              color={cc}
                              onChange={(checked) =>
                                setDraft((current) => ({
                                  ...current,
                                  workbench: { ...current.workbench, sidebarCollapsed: checked },
                                }))
                              }
                            />
                          )}
                          {shouldShow('logsExpanded') && (
                            <ToggleRow
                              label={t('logsExpandedByDefault')}
                              description={t('logsExpandedByDefaultDescription')}
                              checked={draft.workbench.logsExpandedByDefault}
                              color={cc}
                              onChange={(checked) =>
                                setDraft((current) => ({
                                  ...current,
                                  workbench: { ...current.workbench, logsExpandedByDefault: checked },
                                }))
                              }
                            />
                          )}
                        </SectionBlock>
                      ) : null}

                      {/* Shortcuts section */}
                      {(!q || ['commandPalette','newQueryTab','closeQueryTab'].some(k => matchingKeys?.has(k))) && activeSection === 'shortcuts' ? (
                        <SectionBlock title={t('globalShortcuts')}>
                          {shouldShow('commandPalette') && (
                            <SettingRow label={t('commandPaletteLabel')} description={t('shortcutExampleCommandPalette')}>
                              <input
                                value={draft.shortcuts.commandPalette}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    shortcuts: { ...current.shortcuts, commandPalette: event.target.value },
                                  }))
                                }
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                              />
                            </SettingRow>
                          )}
                          {shouldShow('newQueryTab') && (
                            <SettingRow label={t('newQueryTabLabel')} description={t('shortcutExampleNewQueryTab')}>
                              <input
                                value={draft.shortcuts.newQueryTab}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    shortcuts: { ...current.shortcuts, newQueryTab: event.target.value },
                                  }))
                                }
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                              />
                            </SettingRow>
                          )}
                          {shouldShow('closeQueryTab') && (
                            <SettingRow label={t('closeQueryTabLabel')} description={t('shortcutExampleCloseQueryTab')}>
                              <input
                                value={draft.shortcuts.closeQueryTab}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    shortcuts: { ...current.shortcuts, closeQueryTab: event.target.value },
                                  }))
                                }
                                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text outline-none focus:border-primary"
                              />
                            </SettingRow>
                          )}
                        </SectionBlock>
                      ) : null}

                      {/* Startup section */}
                      {(!q || matchingKeys?.has('favoriteConnection')) && activeSection === 'startup' ? (
                        <SectionBlock title={t('startup')}>
                          {shouldShow('favoriteConnection') && (
                            <SettingRow label={t('favoriteConnection')} description={t('favoriteConnectionDescription')}>
                              <AppSelect
                                value={draft.startup.favoriteConnectionId ?? ''}
                                onChange={(value) =>
                                  setDraft((current) => ({
                                    ...current,
                                    startup: { ...current.startup, favoriteConnectionId: value || null },
                                  }))
                                }
                                options={[
                                  { value: '', label: t('none') },
                                  ...connections.map((connection) => ({
                                    value: connection.id,
                                    label: connection.name,
                                  })),
                                ]}
                                className="w-full"
                              />
                            </SettingRow>
                          )}
                        </SectionBlock>
                      ) : null}

                      {/* Advanced section */}
                      {activeSection === 'advanced' && !q ? (
                        <SectionBlock title={t('advancedSection')}>
                          <div className="rounded-lg border border-border/60 bg-background/24 px-3 py-4 text-sm text-muted/70">
                            Advanced settings are available via the JSON tab.
                          </div>
                        </SectionBlock>
                      ) : null}

                      {/* Search results: show matching settings across all sections */}
                      {q && matchingKeys && matchingKeys.size > 0 ? (
                        <>
                          {allSettingRows.filter(r => matchingKeys.has(r.key)).map(row => (
                            <div key={row.key} className="rounded-lg border border-border/60 bg-background/24 px-3 py-3">
                              <div className="mb-0.5 flex items-center gap-2">
                                <span className="text-sm text-text">{row.label}</span>
                                <span className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted/60">
                                  {navItems.find(n => n.id === row.section)?.label}
                                </span>
                              </div>
                              <div className="text-xs text-muted">{row.description}</div>
                            </div>
                          ))}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
              </div>{/* end flex min-h-0 flex-1 */}
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-border/60 px-5 py-3 text-xs text-muted">
                {t('editJsonDirectly')}
              </div>
              <div className="min-h-0 flex-1">
                <Editor
                  height="100%"
                  language="json"
                  theme={resolveConfiguredMonacoTheme(monacoThemeName, themeId)}
                  value={jsonDraft}
                  onChange={(value) => setJsonDraft(value ?? '')}
                  beforeMount={(monaco) => {
                    ensureConfiguredMonacoTheme(monaco, monacoThemeName, themeId);
                  }}
                  options={{
                    minimap: { enabled: true },
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-border/30 hover:text-text"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={activeTab === 'form' ? handleSaveForm : handleSaveJson}
            className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: cc }}
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SectionBlock({ title: _title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">{children}</section>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <div className="mb-0.5 text-sm font-medium text-text">{label}</div>
      <div className="mb-2 text-xs text-muted">{description}</div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  color,
  badge,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  color: string;
  badge?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">{label}</span>
          {badge ? (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
              {badge}
            </span>
          ) : null}
        </div>
        <div className="text-xs text-muted">{description}</div>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} color={color} />
    </label>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  color,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  color: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative shrink-0 rounded-full transition-colors duration-200 focus:outline-none"
      style={{
        width: 36,
        height: 20,
        background: checked ? color : 'var(--bt-border)',
      }}
    >
      <span
        className="absolute top-0.5 rounded-full bg-white shadow-sm transition-transform duration-200"
        style={{
          width: 16,
          height: 16,
          left: 2,
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
        }}
      />
    </button>
  );
}

function DensitySegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: 'compact' | 'comfortable' | 'spacious') => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border/60 bg-background/40 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value as 'compact' | 'comfortable' | 'spacious')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
            value === option.value
              ? 'bg-surface shadow-sm text-text'
              : 'text-muted hover:text-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
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
      showAutocommitInStatusBar: ui.showAutocommitInStatusBar !== false,
      resultPageSize: normalizePageSize(ui.resultPageSize),
      themeId: normalizeThemeId(ui.themeId),
      monacoThemeName: normalizeMonacoThemeName(ui.monacoThemeName),
      density: normalizeDensity(ui.density),
      editorFontSize: normalizeEditorFontSize(ui.editorFontSize),
      formatOnSave: ui.formatOnSave === true,
      autoCloseBrackets: ui.autoCloseBrackets !== false,
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

function normalizeMonacoThemeName(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'default';
}

function normalizeDensity(value: unknown): 'compact' | 'comfortable' | 'spacious' {
  if (value === 'compact') return 'compact';
  if (value === 'spacious') return 'spacious';
  return 'comfortable';
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
