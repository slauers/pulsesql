import { create } from 'zustand';

type SemanticBackgroundState = 'idle' | 'running' | 'success' | 'error';

interface UiPreferencesState {
  semanticBackgroundEnabled: boolean;
  semanticBackgroundState: SemanticBackgroundState;
  semanticBackgroundVersion: number;
  setSemanticBackgroundEnabled: (enabled: boolean) => void;
  setSemanticBackgroundState: (state: SemanticBackgroundState) => void;
}

const UI_PREFERENCES_STORAGE_KEY = 'ui-preferences';

export const useUiPreferencesStore = create<UiPreferencesState>((set) => ({
  semanticBackgroundEnabled: readUiPreferences().semanticBackgroundEnabled,
  semanticBackgroundState: 'idle',
  semanticBackgroundVersion: 0,
  setSemanticBackgroundEnabled: (enabled) =>
    set(() => {
      writeUiPreferences({ semanticBackgroundEnabled: enabled });
      return { semanticBackgroundEnabled: enabled };
    }),
  setSemanticBackgroundState: (state) =>
    set((current) => ({
      semanticBackgroundState: state,
      semanticBackgroundVersion: state === 'idle' ? current.semanticBackgroundVersion : current.semanticBackgroundVersion + 1,
    })),
}));

function readUiPreferences() {
  try {
    const raw = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return { semanticBackgroundEnabled: true };
    }

    const parsed = JSON.parse(raw) as { semanticBackgroundEnabled?: boolean };
    return {
      semanticBackgroundEnabled: parsed.semanticBackgroundEnabled !== false,
    };
  } catch {
    return { semanticBackgroundEnabled: true };
  }
}

function writeUiPreferences(value: { semanticBackgroundEnabled: boolean }) {
  try {
    localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Preferencia visual nao deve quebrar a aplicacao.
  }
}
