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
    id: 'blacktable-dark',
    label: 'Blacktable Dark',
    mode: 'dark',
    colors: {
      background: '#050913',
      surface: '#0B1220',
      border: '#1A2840',
      primary: '#22C7FF',
      text: '#ECF7FF',
      muted: '#8093B1',
      bodyBackground:
        'radial-gradient(circle at top center, rgba(34, 199, 255, 0.16), transparent 34%), radial-gradient(circle at 18% 18%, rgba(34, 199, 255, 0.08), transparent 24%), linear-gradient(180deg, #08101c 0%, #050913 48%, #04070f 100%)',
      glassPanel: 'rgba(11, 18, 32, 0.78)',
    },
  },
  {
    id: 'night-blue',
    label: 'Night Blue',
    mode: 'dark',
    colors: {
      background: '#07111E',
      surface: '#0D1A2B',
      border: '#213756',
      primary: '#5BD1FF',
      text: '#EAF6FF',
      muted: '#92A8C5',
      bodyBackground:
        'radial-gradient(circle at top center, rgba(91, 209, 255, 0.18), transparent 32%), radial-gradient(circle at 78% 12%, rgba(56, 189, 248, 0.10), transparent 24%), linear-gradient(180deg, #0b1728 0%, #07111e 50%, #050d18 100%)',
      glassPanel: 'rgba(13, 26, 43, 0.8)',
    },
  },
];

export function getThemeById(themeId: string) {
  return APP_THEMES.find((theme) => theme.id === themeId) ?? APP_THEMES[0];
}
