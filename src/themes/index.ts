export type ThemeDensity = 'compact' | 'comfortable';

export interface AppThemeDefinition {
  id: string;
  label: string;
  mode: 'dark' | 'light';
  colors: {
    background: string;
    surface: string;
    border: string;
    primary: string;
    text: string;
    muted: string;
    bodyBackground: string;
    glassPanel: string;
  };
}

export const APP_THEMES: AppThemeDefinition[] = [
  {
    id: 'pulsesql-dark',
    label: 'PulseSQL Dark',
    mode: 'dark',
    colors: {
      background: '#0B0F14',
      surface: '#10171F',
      border: '#1D2A34',
      primary: '#2BD3C9',
      text: '#E6EDF3',
      muted: '#88A0AF',
      bodyBackground:
        'radial-gradient(circle at top center, rgba(43, 211, 201, 0.16), transparent 34%), radial-gradient(circle at 16% 18%, rgba(43, 211, 201, 0.08), transparent 22%), linear-gradient(180deg, #0d1218 0%, #0b0f14 54%, #090d11 100%)',
      glassPanel: 'rgba(16, 23, 31, 0.8)',
    },
  },
  {
    id: 'teal-grid',
    label: 'Teal Grid',
    mode: 'dark',
    colors: {
      background: '#0A1116',
      surface: '#111C24',
      border: '#233540',
      primary: '#47E1D7',
      text: '#EAF4F6',
      muted: '#8EA6B0',
      bodyBackground:
        'radial-gradient(circle at top center, rgba(71, 225, 215, 0.18), transparent 32%), radial-gradient(circle at 80% 12%, rgba(43, 211, 201, 0.10), transparent 24%), linear-gradient(180deg, #0e171e 0%, #0a1116 52%, #081015 100%)',
      glassPanel: 'rgba(17, 28, 36, 0.82)',
    },
  },
];

export function getThemeById(themeId: string) {
  return APP_THEMES.find((theme) => theme.id === themeId) ?? APP_THEMES[0];
}
