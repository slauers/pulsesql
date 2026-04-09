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
  updateTabContent: (id: string, content: string) => void;
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
  
  updateTabContent: (id, content) => set((state) => ({
    tabs: state.tabs.map(t => t.id === id ? { ...t, content } : t)
  })),
  
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
