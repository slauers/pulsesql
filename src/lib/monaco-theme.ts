import type * as Monaco from 'monaco-editor';

export function ensureMonacoThemes(monaco: typeof Monaco) {
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
      'editor.background': '#0B0F14',
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
      'editor.background': '#0A1116',
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
}

export function resolveMonacoTheme(themeId: string) {
  if (themeId === 'teal-grid') {
    return 'teal-grid';
  }

  return 'pulsesql-dark';
}
