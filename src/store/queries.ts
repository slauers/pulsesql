import { create } from 'zustand';

export interface QueryTab {
  id: string;
  title: string;
  content: string;
}

interface QueriesState {
  tabs: QueryTab[];
  activeTabId: string | null;
  addTab: () => void;
  addTabWithContent: (content: string, title?: string) => string;
  updateTabContent: (id: string, content: string) => void;
  replaceActiveTabContent: (content: string, title?: string) => string | null;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

export const useQueriesStore = create<QueriesState>((set) => ({
  tabs: [{ id: '1', title: 'Query 1', content: 'SELECT * FROM information_schema.tables LIMIT 10;' }],
  activeTabId: '1',
  
  addTab: () => set((state) => {
    const newId = crypto.randomUUID();
    const newTab = { id: newId, title: `Query ${state.tabs.length + 1}`, content: '' };
    return { tabs: [...state.tabs, newTab], activeTabId: newId };
  }),

  addTabWithContent: (content, title) => {
    const newId = crypto.randomUUID();
    set((state) => {
      const newTab = {
        id: newId,
        title: title?.trim() || `Query ${state.tabs.length + 1}`,
        content,
      };
      return { tabs: [...state.tabs, newTab], activeTabId: newId };
    });
    return newId;
  },
  
  updateTabContent: (id, content) => set((state) => ({
    tabs: state.tabs.map(t => t.id === id ? { ...t, content } : t)
  })),

  replaceActiveTabContent: (content, title) => {
    let updatedTabId: string | null = null;

    set((state) => {
      if (!state.activeTabId) {
        updatedTabId = crypto.randomUUID();
        return {
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
      }

      updatedTabId = state.activeTabId;
      return {
        tabs: state.tabs.map((tab) =>
          tab.id === state.activeTabId
            ? {
                ...tab,
                title: title?.trim() || tab.title,
                content,
              }
            : tab,
        ),
      };
    });

    return updatedTabId;
  },
  
  closeTab: (id) => set((state) => {
    const newTabs = state.tabs.filter(t => t.id !== id);
    let newActiveId = state.activeTabId;
    if (state.activeTabId === id) {
      newActiveId = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null;
    }
    return { tabs: newTabs, activeTabId: newActiveId };
  }),
  
  setActiveTab: (id) => set({ activeTabId: id }),
}));
