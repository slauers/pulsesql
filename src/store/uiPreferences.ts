import { create } from 'zustand';
import { readSystemConfig, updateSystemConfig } from './systemConfig';
import type { AppLocale } from '../i18n';

type SemanticBackgroundState = 'idle' | 'running' | 'success' | 'warning' | 'error';

interface UiPreferencesState {
  locale: AppLocale;
  semanticBackgroundEnabled: boolean;
  showServerTimeInStatusBar: boolean;
  showAutocommitInStatusBar: boolean;
  semanticBackgroundState: SemanticBackgroundState;
  semanticBackgroundVersion: number;
  resultPageSize: number;
  themeId: string;
  monacoThemeName: string;
  density: 'compact' | 'comfortable' | 'spacious';
  editorFontSize: number;
  formatOnSave: boolean;
  autoCloseBrackets: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  logsExpandedByDefault: boolean;
  transparencySystemUIEnabled: boolean;
  transparencySystemUI: number;
  transparencyEditorEnabled: boolean;
  transparencyEditor: number;
  transparencyGridEnabled: boolean;
  transparencyGrid: number;
  setTransparencySystemUIEnabled: (enabled: boolean) => void;
  setTransparencySystemUI: (value: number) => void;
  setTransparencyEditorEnabled: (enabled: boolean) => void;
  setTransparencyEditor: (value: number) => void;
  setTransparencyGridEnabled: (enabled: boolean) => void;
  setTransparencyGrid: (value: number) => void;
  commandPaletteShortcut: string;
  newQueryTabShortcut: string;
  closeQueryTabShortcut: string;
  runQueryShortcut: string;
  nextQueryTabShortcut: string;
  prevQueryTabShortcut: string;
  duplicateTabShortcut: string;
  saveTabAsSqlShortcut: string;
  toggleSidebarShortcut: string;
  toggleResultGridShortcut: string;
  formatQueryShortcut: string;
  setSemanticBackgroundEnabled: (enabled: boolean) => void;
  setShowServerTimeInStatusBar: (enabled: boolean) => void;
  setShowAutocommitInStatusBar: (enabled: boolean) => void;
  setLocale: (locale: AppLocale) => void;
  setSemanticBackgroundState: (state: SemanticBackgroundState) => void;
  setResultPageSize: (pageSize: number) => void;
  setThemeId: (themeId: string) => void;
  setMonacoThemeName: (themeName: string) => void;
  setDensity: (density: 'compact' | 'comfortable' | 'spacious') => void;
  setEditorFontSize: (fontSize: number) => void;
  setFormatOnSave: (enabled: boolean) => void;
  setAutoCloseBrackets: (enabled: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLogsExpandedByDefault: (expanded: boolean) => void;
  setCommandPaletteShortcut: (shortcut: string) => void;
  setNewQueryTabShortcut: (shortcut: string) => void;
  setCloseQueryTabShortcut: (shortcut: string) => void;
  setRunQueryShortcut: (shortcut: string) => void;
  setNextQueryTabShortcut: (shortcut: string) => void;
  setPrevQueryTabShortcut: (shortcut: string) => void;
  setDuplicateTabShortcut: (shortcut: string) => void;
  setSaveTabAsSqlShortcut: (shortcut: string) => void;
  setToggleSidebarShortcut: (shortcut: string) => void;
  setToggleResultGridShortcut: (shortcut: string) => void;
  setFormatQueryShortcut: (shortcut: string) => void;
}

const systemConfig = readSystemConfig();

export const useUiPreferencesStore = create<UiPreferencesState>((set) => ({
  locale: systemConfig.ui.locale,
  semanticBackgroundEnabled: systemConfig.ui.semanticBackgroundEnabled,
  showServerTimeInStatusBar: systemConfig.ui.showServerTimeInStatusBar,
  showAutocommitInStatusBar: systemConfig.ui.showAutocommitInStatusBar,
  resultPageSize: systemConfig.ui.resultPageSize,
  themeId: systemConfig.ui.themeId,
  monacoThemeName: systemConfig.ui.monacoThemeName,
  density: systemConfig.ui.density,
  editorFontSize: systemConfig.ui.editorFontSize,
  formatOnSave: systemConfig.ui.formatOnSave,
  autoCloseBrackets: systemConfig.ui.autoCloseBrackets,
  sidebarWidth: systemConfig.workbench.sidebarWidth,
  sidebarCollapsed: systemConfig.workbench.sidebarCollapsed,
  logsExpandedByDefault: systemConfig.workbench.logsExpandedByDefault,
  transparencySystemUIEnabled: systemConfig.transparency.systemUIEnabled,
  transparencySystemUI: systemConfig.transparency.systemUI,
  transparencyEditorEnabled: systemConfig.transparency.editorEnabled,
  transparencyEditor: systemConfig.transparency.editor,
  transparencyGridEnabled: systemConfig.transparency.gridEnabled,
  transparencyGrid: systemConfig.transparency.grid,
  commandPaletteShortcut: systemConfig.shortcuts.commandPalette,
  newQueryTabShortcut: systemConfig.shortcuts.newQueryTab,
  closeQueryTabShortcut: systemConfig.shortcuts.closeQueryTab,
  runQueryShortcut: systemConfig.shortcuts.runQuery,
  nextQueryTabShortcut: systemConfig.shortcuts.nextQueryTab,
  prevQueryTabShortcut: systemConfig.shortcuts.prevQueryTab,
  duplicateTabShortcut: systemConfig.shortcuts.duplicateTab,
  saveTabAsSqlShortcut: systemConfig.shortcuts.saveTabAsSql,
  toggleSidebarShortcut: systemConfig.shortcuts.toggleSidebar,
  toggleResultGridShortcut: systemConfig.shortcuts.toggleResultGrid,
  formatQueryShortcut: systemConfig.shortcuts.formatQuery,
  semanticBackgroundState: 'idle',
  semanticBackgroundVersion: 0,
  setLocale: (locale) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          locale,
        },
      }));
      return { locale };
    }),
  setSemanticBackgroundEnabled: (enabled) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          semanticBackgroundEnabled: enabled,
        },
      }));
      return { semanticBackgroundEnabled: enabled };
    }),
  setShowServerTimeInStatusBar: (enabled) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          showServerTimeInStatusBar: enabled,
        },
      }));
      return { showServerTimeInStatusBar: enabled };
    }),
  setShowAutocommitInStatusBar: (enabled) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          showAutocommitInStatusBar: enabled,
        },
      }));
      return { showAutocommitInStatusBar: enabled };
    }),
  setSemanticBackgroundState: (state) =>
    set((current) => ({
      semanticBackgroundState: state,
      semanticBackgroundVersion: state === 'idle' ? current.semanticBackgroundVersion : current.semanticBackgroundVersion + 1,
    })),
  setResultPageSize: (pageSize) =>
    set(() => {
      const normalized = normalizePageSize(pageSize);
      updateSystemConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          resultPageSize: normalized,
        },
      }));
      return { resultPageSize: normalized };
    }),
  setThemeId: (themeId) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          themeId,
        },
      }));
      return { themeId };
    }),
  setMonacoThemeName: (themeName) =>
    set(() => {
      const monacoThemeName = normalizeMonacoThemeName(themeName);
      updateSystemConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          monacoThemeName,
        },
      }));
      return { monacoThemeName };
    }),
  setDensity: (density) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        ui: {
          ...current.ui,
          density,
        },
      }));
      return { density };
    }),
  setEditorFontSize: (fontSize) =>
    set(() => {
      const normalized = normalizeEditorFontSize(fontSize);
      updateSystemConfig((current) => ({
        ...current,
        ui: { ...current.ui, editorFontSize: normalized },
      }));
      return { editorFontSize: normalized };
    }),
  setFormatOnSave: (enabled) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        ui: { ...current.ui, formatOnSave: enabled },
      }));
      return { formatOnSave: enabled };
    }),
  setAutoCloseBrackets: (enabled) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        ui: { ...current.ui, autoCloseBrackets: enabled },
      }));
      return { autoCloseBrackets: enabled };
    }),
  setSidebarWidth: (width) =>
    set(() => {
      const normalized = normalizeSidebarWidth(width);
      updateSystemConfig((current) => ({
        ...current,
        workbench: {
          ...current.workbench,
          sidebarWidth: normalized,
        },
      }));
      return { sidebarWidth: normalized };
    }),
  setSidebarCollapsed: (collapsed) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        workbench: {
          ...current.workbench,
          sidebarCollapsed: collapsed,
        },
      }));
      return { sidebarCollapsed: collapsed };
    }),
  setLogsExpandedByDefault: (expanded) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        workbench: {
          ...current.workbench,
          logsExpandedByDefault: expanded,
        },
      }));
      return { logsExpandedByDefault: expanded };
    }),
  setCommandPaletteShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Shift+P');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: {
          ...current.shortcuts,
          commandPalette: normalized,
        },
      }));
      return { commandPaletteShortcut: normalized };
    }),
  setNewQueryTabShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Alt+N');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: {
          ...current.shortcuts,
          newQueryTab: normalized,
        },
      }));
      return { newQueryTabShortcut: normalized };
    }),
  setCloseQueryTabShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+W');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, closeQueryTab: normalized },
      }));
      return { closeQueryTabShortcut: normalized };
    }),
  setRunQueryShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Enter');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, runQuery: normalized },
      }));
      return { runQueryShortcut: normalized };
    }),
  setNextQueryTabShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Alt+ArrowRight');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, nextQueryTab: normalized },
      }));
      return { nextQueryTabShortcut: normalized };
    }),
  setPrevQueryTabShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Alt+ArrowLeft');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, prevQueryTab: normalized },
      }));
      return { prevQueryTabShortcut: normalized };
    }),
  setDuplicateTabShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Alt+D');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, duplicateTab: normalized },
      }));
      return { duplicateTabShortcut: normalized };
    }),
  setSaveTabAsSqlShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Shift+S');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, saveTabAsSql: normalized },
      }));
      return { saveTabAsSqlShortcut: normalized };
    }),
  setToggleSidebarShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+B');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, toggleSidebar: normalized },
      }));
      return { toggleSidebarShortcut: normalized };
    }),
  setToggleResultGridShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Shift+G');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, toggleResultGrid: normalized },
      }));
      return { toggleResultGridShortcut: normalized };
    }),
  setFormatQueryShortcut: (shortcut) =>
    set(() => {
      const normalized = normalizeShortcut(shortcut, 'CmdOrCtrl+Shift+L');
      updateSystemConfig((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, formatQuery: normalized },
      }));
      return { formatQueryShortcut: normalized };
    }),
  setTransparencySystemUIEnabled: (enabled) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        transparency: { ...current.transparency, systemUIEnabled: enabled },
      }));
      return { transparencySystemUIEnabled: enabled };
    }),
  setTransparencySystemUI: (value) =>
    set(() => {
      const v = Math.min(1, Math.max(0.2, Math.round(value * 100) / 100));
      updateSystemConfig((current) => ({
        ...current,
        transparency: { ...current.transparency, systemUI: v },
      }));
      return { transparencySystemUI: v };
    }),
  setTransparencyEditorEnabled: (enabled) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        transparency: { ...current.transparency, editorEnabled: enabled },
      }));
      return { transparencyEditorEnabled: enabled };
    }),
  setTransparencyEditor: (value) =>
    set(() => {
      const v = Math.min(1, Math.max(0.2, Math.round(value * 100) / 100));
      updateSystemConfig((current) => ({
        ...current,
        transparency: { ...current.transparency, editor: v },
      }));
      return { transparencyEditor: v };
    }),
  setTransparencyGridEnabled: (enabled) =>
    set(() => {
      updateSystemConfig((current) => ({
        ...current,
        transparency: { ...current.transparency, gridEnabled: enabled },
      }));
      return { transparencyGridEnabled: enabled };
    }),
  setTransparencyGrid: (value) =>
    set(() => {
      const v = Math.min(1, Math.max(0.2, Math.round(value * 100) / 100));
      updateSystemConfig((current) => ({
        ...current,
        transparency: { ...current.transparency, grid: v },
      }));
      return { transparencyGrid: v };
    }),
}));

function normalizePageSize(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1000, Math.max(1, Math.round(value)));
  }

  return 100;
}

function normalizeMonacoThemeName(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'default';
}

function normalizeEditorFontSize(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(20, Math.max(11, Math.round(value)));
  }

  return 14;
}

function normalizeSidebarWidth(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(520, Math.max(300, Math.round(value)));
  }

  return 290;
}

function normalizeShortcut(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}
