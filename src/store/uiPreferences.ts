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
  density: 'compact' | 'comfortable';
  editorFontSize: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  logsExpandedByDefault: boolean;
  commandPaletteShortcut: string;
  newQueryTabShortcut: string;
  closeQueryTabShortcut: string;
  setSemanticBackgroundEnabled: (enabled: boolean) => void;
  setShowServerTimeInStatusBar: (enabled: boolean) => void;
  setShowAutocommitInStatusBar: (enabled: boolean) => void;
  setLocale: (locale: AppLocale) => void;
  setSemanticBackgroundState: (state: SemanticBackgroundState) => void;
  setResultPageSize: (pageSize: number) => void;
  setThemeId: (themeId: string) => void;
  setDensity: (density: 'compact' | 'comfortable') => void;
  setEditorFontSize: (fontSize: number) => void;
  setSidebarWidth: (width: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLogsExpandedByDefault: (expanded: boolean) => void;
  setCommandPaletteShortcut: (shortcut: string) => void;
  setNewQueryTabShortcut: (shortcut: string) => void;
  setCloseQueryTabShortcut: (shortcut: string) => void;
}

const systemConfig = readSystemConfig();

export const useUiPreferencesStore = create<UiPreferencesState>((set) => ({
  locale: systemConfig.ui.locale,
  semanticBackgroundEnabled: systemConfig.ui.semanticBackgroundEnabled,
  showServerTimeInStatusBar: systemConfig.ui.showServerTimeInStatusBar,
  showAutocommitInStatusBar: systemConfig.ui.showAutocommitInStatusBar,
  resultPageSize: systemConfig.ui.resultPageSize,
  themeId: systemConfig.ui.themeId,
  density: systemConfig.ui.density,
  editorFontSize: systemConfig.ui.editorFontSize,
  sidebarWidth: systemConfig.workbench.sidebarWidth,
  sidebarCollapsed: systemConfig.workbench.sidebarCollapsed,
  logsExpandedByDefault: systemConfig.workbench.logsExpandedByDefault,
  commandPaletteShortcut: systemConfig.shortcuts.commandPalette,
  newQueryTabShortcut: systemConfig.shortcuts.newQueryTab,
  closeQueryTabShortcut: systemConfig.shortcuts.closeQueryTab,
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
        ui: {
          ...current.ui,
          editorFontSize: normalized,
        },
      }));
      return { editorFontSize: normalized };
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
        shortcuts: {
          ...current.shortcuts,
          closeQueryTab: normalized,
        },
      }));
      return { closeQueryTabShortcut: normalized };
    }),
}));

function normalizePageSize(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1000, Math.max(1, Math.round(value)));
  }

  return 100;
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
