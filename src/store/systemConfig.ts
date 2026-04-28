export interface SystemConfig {
  version: number;
  ui: {
    locale: 'pt-BR' | 'en-US';
    semanticBackgroundEnabled: boolean;
    showServerTimeInStatusBar: boolean;
    showAutocommitInStatusBar: boolean;
    resultPageSize: number;
    themeId: string;
    monacoThemeName: string;
    density: 'compact' | 'comfortable' | 'spacious';
    editorFontSize: number;
    formatOnSave: boolean;
    autoCloseBrackets: boolean;
  };
  workbench: {
    sidebarWidth: number;
    sidebarCollapsed: boolean;
    logsExpandedByDefault: boolean;
  };
  shortcuts: {
    commandPalette: string;
    newQueryTab: string;
    closeQueryTab: string;
  };
  startup: {
    favoriteConnectionId: string | null;
  };
}

const SYSTEM_CONFIG_STORAGE_KEY = 'pulsesql-system-config';
const LEGACY_UI_PREFERENCES_STORAGE_KEY = 'ui-preferences';
const LEGACY_FAVORITE_CONNECTION_STORAGE_KEY = 'favorite-connection-id';

export function readSystemConfig(): SystemConfig {
  const defaults = defaultSystemConfig();

  try {
    const raw = localStorage.getItem(SYSTEM_CONFIG_STORAGE_KEY);
    if (raw) {
      return normalizeSystemConfig(JSON.parse(raw));
    }
  } catch {
    // Ignore malformed config and fall back to defaults plus legacy migration.
  }

  return normalizeSystemConfig({
    ...defaults,
    ui: readLegacyUiPreferences(defaults.ui),
    startup: readLegacyStartupSettings(defaults.startup),
  });
}

export function writeSystemConfig(config: SystemConfig) {
  try {
    localStorage.setItem(SYSTEM_CONFIG_STORAGE_KEY, JSON.stringify(normalizeSystemConfig(config)));
  } catch (error) {
    console.warn('[PulseSQL] Failed to persist system config — localStorage may be full:', error);
  }
}

export function updateSystemConfig(updater: (current: SystemConfig) => SystemConfig) {
  const current = readSystemConfig();
  const next = updater(current);
  writeSystemConfig(next);
  return next;
}

export function defaultSystemConfig(): SystemConfig {
  return {
    version: 4,
    ui: {
      locale: 'pt-BR',
      semanticBackgroundEnabled: true,
      showServerTimeInStatusBar: false,
      showAutocommitInStatusBar: true,
      resultPageSize: 100,
      themeId: 'pulsesql-minimal-dark',
      monacoThemeName: 'default',
      density: 'comfortable',
      editorFontSize: 14,
      formatOnSave: false,
      autoCloseBrackets: true,
    },
    workbench: {
      sidebarWidth: 290,
      sidebarCollapsed: false,
      logsExpandedByDefault: false,
    },
    shortcuts: {
      commandPalette: 'CmdOrCtrl+Shift+P',
      newQueryTab: 'CmdOrCtrl+Alt+N',
      closeQueryTab: 'CmdOrCtrl+W',
    },
    startup: {
      favoriteConnectionId: null,
    },
  };
}

function normalizeSystemConfig(input: unknown): SystemConfig {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const ui = raw.ui && typeof raw.ui === 'object' ? (raw.ui as Record<string, unknown>) : {};
  const workbench =
    raw.workbench && typeof raw.workbench === 'object' ? (raw.workbench as Record<string, unknown>) : {};
  const shortcuts =
    raw.shortcuts && typeof raw.shortcuts === 'object' ? (raw.shortcuts as Record<string, unknown>) : {};
  const startup =
    raw.startup && typeof raw.startup === 'object' ? (raw.startup as Record<string, unknown>) : {};

  return {
    version: typeof raw.version === 'number' ? raw.version : 4,
    ui: {
      locale: normalizeLocale(ui.locale),
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

function readLegacyUiPreferences(defaults: SystemConfig['ui']): SystemConfig['ui'] {
  try {
    const raw = localStorage.getItem(LEGACY_UI_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as {
      semanticBackgroundEnabled?: boolean;
      resultPageSize?: number;
    };

    return {
      locale: defaults.locale,
      semanticBackgroundEnabled: parsed.semanticBackgroundEnabled !== false,
      showServerTimeInStatusBar: defaults.showServerTimeInStatusBar,
      showAutocommitInStatusBar: defaults.showAutocommitInStatusBar,
      resultPageSize: normalizePageSize(parsed.resultPageSize),
      themeId: defaults.themeId,
      monacoThemeName: defaults.monacoThemeName,
      density: defaults.density,
      editorFontSize: defaults.editorFontSize,
      formatOnSave: defaults.formatOnSave,
      autoCloseBrackets: defaults.autoCloseBrackets,
    };
  } catch {
    return defaults;
  }
}

function readLegacyStartupSettings(defaults: SystemConfig['startup']): SystemConfig['startup'] {
  const favoriteConnectionId = localStorage.getItem(LEGACY_FAVORITE_CONNECTION_STORAGE_KEY);

  return {
    favoriteConnectionId:
      favoriteConnectionId && favoriteConnectionId.trim().length > 0
        ? favoriteConnectionId
        : defaults.favoriteConnectionId,
  };
}

function normalizePageSize(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1000, Math.max(1, Math.round(value)));
  }

  return 100;
}

function normalizeLocale(value: unknown): 'pt-BR' | 'en-US' {
  return value === 'en-US' ? 'en-US' : 'pt-BR';
}

function normalizeThemeId(value: unknown) {
  if (
    value === 'pulsesql-minimal-dark' ||
    value === 'pulsesql-dark' ||
    value === 'teal-grid' ||
    value === 'solarized-dark'
  ) {
    return value;
  }

  return 'pulsesql-minimal-dark';
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
