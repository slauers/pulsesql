import { create } from 'zustand';

export type RuntimeConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

interface ConnectionRuntimeState {
  runtimeStatus: Record<string, RuntimeConnectionState>;
  connectionLogs: Record<string, string[]>;
  logsExpandedByConnection: Record<string, boolean>;
  appendLog: (connId: string, message: string) => void;
  setRuntimeStatus: (connId: string, state: RuntimeConnectionState) => void;
  setLogsExpanded: (connId: string, expanded: boolean) => void;
  removeConnectionRuntime: (connId: string) => void;
}

const LOG_VISIBILITY_STORAGE_KEY = 'connection-log-visibility';

export const useConnectionRuntimeStore = create<ConnectionRuntimeState>((set) => ({
  runtimeStatus: {},
  connectionLogs: {},
  logsExpandedByConnection: readLogVisibilityState(),
  appendLog: (connId, message) =>
    set((current) => {
      const timestamp = new Date().toLocaleTimeString('pt-BR');
      return {
        connectionLogs: {
          ...current.connectionLogs,
          [connId]: [`[${timestamp}] ${message}`, ...(current.connectionLogs[connId] ?? [])].slice(0, 40),
        },
      };
    }),
  setRuntimeStatus: (connId, state) =>
    set((current) => ({
      runtimeStatus: {
        ...current.runtimeStatus,
        [connId]: state,
      },
    })),
  setLogsExpanded: (connId, expanded) =>
    set((current) => {
      const next = {
        ...current.logsExpandedByConnection,
        [connId]: expanded,
      };
      writeLogVisibilityState(next);
      return { logsExpandedByConnection: next };
    }),
  removeConnectionRuntime: (connId) =>
    set((current) => {
      const runtimeStatus = { ...current.runtimeStatus };
      const connectionLogs = { ...current.connectionLogs };
      const logsExpandedByConnection = { ...current.logsExpandedByConnection };
      delete runtimeStatus[connId];
      delete connectionLogs[connId];
      delete logsExpandedByConnection[connId];
      writeLogVisibilityState(logsExpandedByConnection);
      return {
        runtimeStatus,
        connectionLogs,
        logsExpandedByConnection,
      };
    }),
}));

function readLogVisibilityState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LOG_VISIBILITY_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLogVisibilityState(value: Record<string, boolean>) {
  try {
    localStorage.setItem(LOG_VISIBILITY_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Persistencia de UI nao deve quebrar a aplicacao.
  }
}
