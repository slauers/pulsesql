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
      background: '#08111A',
      surface: '#0D1824',
      border: '#1A2C3C',
      primary: '#47C4E8',
      text: '#EDF4FB',
      muted: '#8AA3B6',
      bodyBackground: '#08111A',
      glassPanel: 'rgba(13, 24, 36, 0.85)',
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
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    mode: 'dark',
    colors: {
      background: '#002B36',
      surface: '#073642',
      border: '#124B56',
      primary: '#2AA198',
      text: '#D2DEE0',
      muted: '#93A1A1',
      bodyBackground:
        'radial-gradient(circle at 12% 0%, rgba(42, 161, 152, 0.16), transparent 30%), radial-gradient(circle at 90% 8%, rgba(181, 137, 0, 0.10), transparent 28%), linear-gradient(180deg, #002B36 0%, #001E27 100%)',
      glassPanel: 'rgba(7, 54, 66, 0.86)',
    },
  },
];

export function getThemeById(themeId: string) {
  return APP_THEMES.find((theme) => theme.id === themeId) ?? APP_THEMES[0];
}
