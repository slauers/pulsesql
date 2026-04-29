import type * as Monaco from 'monaco-editor';
import { getThemeById, type AppThemeDefinition } from '../themes';

const AUTO_MONACO_THEME_ID = 'pulsesql-auto';

export function ensureMonacoThemes(monaco: typeof Monaco) {
  monaco.editor.defineTheme('pulsesql-minimal-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '67E8F9' },
      { token: 'number', foreground: '86EFAC' },
      { token: 'string', foreground: 'FDE68A' },
      { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
      { token: 'delimiter', foreground: '94A3B8' },
      { token: 'operator', foreground: 'CBD5E1' },
      { token: 'identifier', foreground: 'E6EDF3' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.foreground': '#E6EDF3',
      'editor.lineHighlightBackground': '#0B1219',
      'editorCursor.foreground': '#0E7490',
      'editorLineNumber.foreground': '#4B5B68',
      'editorLineNumber.activeForeground': '#A7B4C0',
      'editor.selectionBackground': '#0D2B35',
      'editor.inactiveSelectionBackground': '#0B1D25',
      'editorIndentGuide.background1': '#14202A',
      'editorIndentGuide.activeBackground1': '#263846',
      'editorOverviewRuler.border': '#05080B',
      'minimap.background': '#00000000',
      'minimapSlider.background': '#33415544',
      'minimapSlider.hoverBackground': '#47556966',
      'minimapSlider.activeBackground': '#64748B88',
      'scrollbarSlider.background': '#33415544',
      'scrollbarSlider.hoverBackground': '#47556966',
      'scrollbarSlider.activeBackground': '#64748B88',
      'editorSuggestWidget.background': '#0D131A',
      'editorSuggestWidget.border': '#1C2833',
      'editorSuggestWidget.foreground': '#E6EDF3',
      'editorSuggestWidget.highlightForeground': '#38BDF8',
      'editorSuggestWidget.selectedBackground': '#142635',
      'editorSuggestWidget.selectedForeground': '#FFFFFF',
      'editorSuggestWidget.selectedIconForeground': '#0E7490',
      'editorSuggestWidgetStatus.foreground': '#7D8B99',
    },
  });

  monaco.editor.defineTheme('pulsesql-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '4BE3D7' },
      { token: 'number', foreground: '9AE6B4' },
      { token: 'string', foreground: 'B7F071' },
      { token: 'comment', foreground: '607789' },
      { token: 'delimiter', foreground: '9DB2C3' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.foreground': '#E6EDF3',
      'editor.lineHighlightBackground': '#121922',
      'editorCursor.foreground': '#4BE3D7',
      'editorLineNumber.foreground': '#526575',
      'editorLineNumber.activeForeground': '#AFC2CE',
      'editor.selectionBackground': '#12353A',
      'editor.inactiveSelectionBackground': '#10292D',
      'editorIndentGuide.background1': '#18222C',
      'editorIndentGuide.activeBackground1': '#27404B',
      'editorSuggestWidget.background': '#10171F',
      'editorSuggestWidget.border': '#1D2A34',
      'editorSuggestWidget.foreground': '#E6EDF3',
      'editorSuggestWidget.highlightForeground': '#4BE3D7',
      'editorSuggestWidget.selectedBackground': '#173138',
      'editorSuggestWidget.selectedForeground': '#FFFFFF',
      'editorSuggestWidget.selectedIconForeground': '#4BE3D7',
      'editorSuggestWidgetStatus.foreground': '#88A0AF',
    },
  });

  monaco.editor.defineTheme('teal-grid', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '6BF0E7' },
      { token: 'number', foreground: '9EDBFF' },
      { token: 'string', foreground: 'C5F58A' },
      { token: 'comment', foreground: '6A8193' },
      { token: 'delimiter', foreground: 'A4BBC8' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.foreground': '#EAF4F6',
      'editor.lineHighlightBackground': '#132028',
      'editorCursor.foreground': '#6BF0E7',
      'editorLineNumber.foreground': '#576D7C',
      'editorLineNumber.activeForeground': '#B8CBD4',
      'editor.selectionBackground': '#15434A',
      'editor.inactiveSelectionBackground': '#103238',
      'editorIndentGuide.background1': '#18252E',
      'editorIndentGuide.activeBackground1': '#28505A',
      'editorSuggestWidget.background': '#111C24',
      'editorSuggestWidget.border': '#233540',
      'editorSuggestWidget.foreground': '#EAF4F6',
      'editorSuggestWidget.highlightForeground': '#6BF0E7',
      'editorSuggestWidget.selectedBackground': '#183840',
      'editorSuggestWidget.selectedForeground': '#FFFFFF',
      'editorSuggestWidget.selectedIconForeground': '#6BF0E7',
      'editorSuggestWidgetStatus.foreground': '#8EA6B0',
    },
  });

  monaco.editor.defineTheme('solarized-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '859900' },
      { token: 'number', foreground: 'D33682' },
      { token: 'string', foreground: '2AA198' },
      { token: 'comment', foreground: '586E75', fontStyle: 'italic' },
      { token: 'delimiter', foreground: '93A1A1' },
      { token: 'operator', foreground: '839496' },
      { token: 'identifier', foreground: 'D2DEE0' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.foreground': '#D2DEE0',
      'editor.lineHighlightBackground': '#073642',
      'editorCursor.foreground': '#93A1A1',
      'editorLineNumber.foreground': '#586E75',
      'editorLineNumber.activeForeground': '#93A1A1',
      'editor.selectionBackground': '#124B56',
      'editor.inactiveSelectionBackground': '#073642',
      'editorIndentGuide.background1': '#073642',
      'editorIndentGuide.activeBackground1': '#586E75',
      'editorOverviewRuler.border': '#073642',
      'minimap.background': '#00000000',
      'minimapSlider.background': '#586E7544',
      'minimapSlider.hoverBackground': '#586E7566',
      'minimapSlider.activeBackground': '#586E7588',
      'scrollbarSlider.background': '#586E7544',
      'scrollbarSlider.hoverBackground': '#586E7566',
      'scrollbarSlider.activeBackground': '#586E7588',
      'editorSuggestWidget.background': '#073642',
      'editorSuggestWidget.border': '#124B56',
      'editorSuggestWidget.foreground': '#D2DEE0',
      'editorSuggestWidget.highlightForeground': '#B58900',
      'editorSuggestWidget.selectedBackground': '#124B56',
      'editorSuggestWidget.selectedForeground': '#FDF6E3',
      'editorSuggestWidget.selectedIconForeground': '#2AA198',
      'editorSuggestWidgetStatus.foreground': '#93A1A1',
    },
  });

  monaco.editor.defineTheme('monokai', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'F92672' },
      { token: 'number', foreground: 'AE81FF' },
      { token: 'string', foreground: 'E6DB74' },
      { token: 'comment', foreground: '75715E', fontStyle: 'italic' },
      { token: 'delimiter', foreground: 'F8F8F2' },
      { token: 'operator', foreground: 'F92672' },
      { token: 'identifier', foreground: 'F8F8F2' },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.foreground': '#F8F8F2',
      'editor.lineHighlightBackground': '#3E3D32',
      'editorCursor.foreground': '#F8F8F0',
      'editorLineNumber.foreground': '#90908A',
      'editorLineNumber.activeForeground': '#F8F8F2',
      'editor.selectionBackground': '#49483E',
      'editor.inactiveSelectionBackground': '#3E3D32',
      'editorIndentGuide.background1': '#3B3A32',
      'editorIndentGuide.activeBackground1': '#5A594D',
      'editorOverviewRuler.border': '#272822',
      'minimap.background': '#00000000',
      'minimapSlider.background': '#75715E44',
      'minimapSlider.hoverBackground': '#75715E66',
      'minimapSlider.activeBackground': '#75715E88',
      'scrollbarSlider.background': '#75715E44',
      'scrollbarSlider.hoverBackground': '#75715E66',
      'scrollbarSlider.activeBackground': '#75715E88',
      'editorSuggestWidget.background': '#3E3D32',
      'editorSuggestWidget.border': '#49483E',
      'editorSuggestWidget.foreground': '#F8F8F2',
      'editorSuggestWidget.highlightForeground': '#A6E22E',
      'editorSuggestWidget.selectedBackground': '#49483E',
      'editorSuggestWidget.selectedForeground': '#FFFFFF',
      'editorSuggestWidget.selectedIconForeground': '#66D9EF',
      'editorSuggestWidgetStatus.foreground': '#CFCFC2',
    },
  });
}

export function resolveMonacoTheme(themeId: string) {
  const normalizedThemeId = themeId.trim();

  if (!normalizedThemeId) {
    return 'solarized-dark';
  }

  if (themeId === 'solarized-dark') {
    return 'solarized-dark';
  }

  if (themeId === 'pulsesql-minimal-dark') {
    return 'pulsesql-minimal-dark';
  }

  if (themeId === 'teal-grid') {
    return 'teal-grid';
  }

  if (themeId === 'pulsesql-dark') {
    return 'pulsesql-dark';
  }

  return normalizedThemeId;
}

export function resolveConfiguredMonacoTheme(monacoThemeName: string, appThemeId: string) {
  const normalizedThemeName = monacoThemeName.trim();

  if (normalizedThemeName === 'auto') {
    return AUTO_MONACO_THEME_ID;
  }

  if (normalizedThemeName === 'default') {
    return resolveMonacoTheme(appThemeId);
  }

  return resolveMonacoTheme(normalizedThemeName);
}

export function ensureConfiguredMonacoTheme(
  monaco: typeof Monaco,
  monacoThemeName: string,
  appThemeId: string,
) {
  ensureMonacoThemes(monaco);

  if (monacoThemeName.trim() === 'auto') {
    defineAutoMonacoTheme(monaco, getThemeById(appThemeId));
  }

  return resolveConfiguredMonacoTheme(monacoThemeName, appThemeId);
}

function defineAutoMonacoTheme(monaco: typeof Monaco, appTheme: AppThemeDefinition) {
  const { background, surface, border, primary, text, muted } = appTheme.colors;
  const accentSoft = mixHex(primary, background, 0.62);
  const accentFaint = mixHex(primary, background, 0.2);
  const surfaceRaised = mixHex(surface, background, 0.76);

  monaco.editor.defineTheme(AUTO_MONACO_THEME_ID, {
    base: appTheme.mode === 'light' ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: stripHash(accentSoft) },
      { token: 'number', foreground: stripHash(mixHex(primary, text, 0.38)) },
      { token: 'string', foreground: stripHash(mixHex(primary, text, 0.46)) },
      { token: 'comment', foreground: stripHash(muted), fontStyle: 'italic' },
      { token: 'delimiter', foreground: stripHash(mixHex(muted, text, 0.45)) },
      { token: 'operator', foreground: stripHash(accentSoft) },
      { token: 'identifier', foreground: stripHash(text) },
    ],
    colors: {
      'editor.background': '#00000000',
      'editor.foreground': text,
      'editor.lineHighlightBackground': mixHex(primary, background, 0.11),
      'editorCursor.foreground': accentSoft,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': text,
      'editor.selectionBackground': mixHex(primary, background, 0.26),
      'editor.inactiveSelectionBackground': mixHex(primary, background, 0.14),
      'editorIndentGuide.background1': mixHex(border, background, 0.62),
      'editorIndentGuide.activeBackground1': mixHex(primary, background, 0.32),
      'editorOverviewRuler.border': border,
      'minimap.background': '#00000000',
      'minimapSlider.background': `#${stripHash(accentFaint)}66`,
      'minimapSlider.hoverBackground': `#${stripHash(accentFaint)}88`,
      'minimapSlider.activeBackground': `#${stripHash(accentFaint)}AA`,
      'scrollbarSlider.background': `#${stripHash(accentFaint)}66`,
      'scrollbarSlider.hoverBackground': `#${stripHash(accentFaint)}88`,
      'scrollbarSlider.activeBackground': `#${stripHash(accentFaint)}AA`,
      'editorSuggestWidget.background': surfaceRaised,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.foreground': text,
      'editorSuggestWidget.highlightForeground': accentSoft,
      'editorSuggestWidget.selectedBackground': mixHex(primary, background, 0.18),
      'editorSuggestWidget.selectedForeground': text,
      'editorSuggestWidget.selectedIconForeground': accentSoft,
      'editorSuggestWidgetStatus.foreground': muted,
    },
  });
}

function mixHex(foreground: string, background: string, amount: number) {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);

  if (!fg || !bg) {
    return foreground;
  }

  const clampAmount = Math.min(1, Math.max(0, amount));
  const mixed = fg.map((channel, index) =>
    Math.round(channel * clampAmount + bg[index] * (1 - clampAmount)),
  );

  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function parseHexColor(value: string) {
  const normalized = stripHash(value);
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function stripHash(value: string) {
  return value.replace(/^#/, '');
}
