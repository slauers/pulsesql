import { create } from 'zustand';

export interface QueryTab {
  id: string;
  title: string;
  content: string;
}

interface QueriesState {
  tabs: QueryTab[];
  activeTabId: string | null;
  pendingExecutionTabId: string | null;
  addTab: () => void;
  addTabWithContent: (content: string, title?: string) => string;
  updateTabContent: (id: string, content: string) => void;
  replaceActiveTabContent: (content: string, title?: string) => string | null;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  requestTabExecution: (id: string) => void;
  clearPendingExecution: () => void;
}

const QUERY_SESSION_STORAGE_KEY = 'query-session';

export const useQueriesStore = create<QueriesState>((set) => ({
  ...readQueriesState(),
  pendingExecutionTabId: null,
  
  addTab: () => set((state) => {
    const newId = crypto.randomUUID();
    const newTab = { id: newId, title: `Query ${state.tabs.length + 1}`, content: '' };
    const next = { tabs: [...state.tabs, newTab], activeTabId: newId };
    writeQueriesState(next);
    return next;
  }),

  addTabWithContent: (content, title) => {
    const newId = crypto.randomUUID();
    set((state) => {
      const newTab = {
        id: newId,
        title: title?.trim() || `Query ${state.tabs.length + 1}`,
        content,
      };
      const next = { tabs: [...state.tabs, newTab], activeTabId: newId };
      writeQueriesState(next);
      return next;
    });
    return newId;
  },
  
  updateTabContent: (id, content) => set((state) => {
    const next = {
      tabs: state.tabs.map(t => t.id === id ? { ...t, content } : t),
      activeTabId: state.activeTabId,
    };
    writeQueriesState(next);
    return next;
  }),

  replaceActiveTabContent: (content, title) => {
    let updatedTabId: string | null = null;

    set((state) => {
      if (!state.activeTabId) {
        updatedTabId = crypto.randomUUID();
        const next = {
          tabs: [
            ...state.tabs,
            {
              id: updatedTabId,
              title: title?.trim() || `Query ${state.tabs.length + 1}`,
              content,
            },
          ],
          activeTabId: updatedTabId,
        };
        writeQueriesState(next);
        return next;
      }

      updatedTabId = state.activeTabId;
      const next = {
        tabs: state.tabs.map((tab) =>
          tab.id === state.activeTabId
            ? {
                ...tab,
                title: title?.trim() || tab.title,
                content,
              }
            : tab,
        ),
        activeTabId: state.activeTabId,
      };
      writeQueriesState(next);
      return next;
    });

    return updatedTabId;
  },
  
  closeTab: (id) => set((state) => {
    const newTabs = state.tabs.filter(t => t.id !== id);
    let newActiveId = state.activeTabId;
    if (state.activeTabId === id) {
      newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
    }
    const next = ensureQueriesState({ tabs: newTabs, activeTabId: newActiveId });
    writeQueriesState(next);
    return next;
  }),
  
  setActiveTab: (id) => set((state) => {
    const next = { tabs: state.tabs, activeTabId: id };
    writeQueriesState(next);
    return next;
  }),
  
  requestTabExecution: (id) => set(() => ({
    pendingExecutionTabId: id,
  })),

  clearPendingExecution: () => set(() => ({
    pendingExecutionTabId: null,
  })),
}));

function readQueriesState(): Pick<QueriesState, 'tabs' | 'activeTabId'> {
  try {
    const raw = localStorage.getItem(QUERY_SESSION_STORAGE_KEY);
    if (!raw) {
      return ensureQueriesState({});
    }

    const parsed = JSON.parse(raw);
    return ensureQueriesState(parsed);
  } catch {
    return ensureQueriesState({});
  }
}

function writeQueriesState(value: Pick<QueriesState, 'tabs' | 'activeTabId'>) {
  try {
    localStorage.setItem(QUERY_SESSION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Persistencia de sessao nao deve quebrar o editor.
  }
}

function ensureQueriesState(
  input: Partial<Pick<QueriesState, 'tabs' | 'activeTabId'>>,
): Pick<QueriesState, 'tabs' | 'activeTabId'> {
  const tabs = Array.isArray(input.tabs)
    ? input.tabs.filter(
        (tab): tab is QueryTab =>
          Boolean(tab) &&
          typeof tab === 'object' &&
          typeof tab.id === 'string' &&
          typeof tab.title === 'string' &&
          typeof tab.content === 'string',
      )
    : [];

  if (!tabs.length) {
    return {
      tabs: [{ id: '1', title: 'Query 1', content: '' }],
      activeTabId: '1',
    };
  }

  const activeTabId =
    typeof input.activeTabId === 'string' && tabs.some((tab) => tab.id === input.activeTabId)
      ? input.activeTabId
      : tabs[0].id;

  return { tabs, activeTabId };
}
