import { create } from 'zustand';

export type DatabaseEngine = 'postgres' | 'mysql' | 'oracle';
export type SshAuthMethod = 'password' | 'privateKey';
export type OracleConnectionType = 'serviceName' | 'sid';
export type PostgresSslMode = 'disable' | 'prefer' | 'require';

export interface SshConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  user?: string;
  authMethod?: SshAuthMethod;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface ConnectionConfig {
  id: string;
  name: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  connectTimeoutSeconds?: number;
  autoReconnect?: boolean;
  postgresSslMode?: PostgresSslMode;
  oracleConnectionType?: OracleConnectionType;
  oracleDriverProperties?: string;
  ssh?: SshConfig;
}

interface ConnectionsState {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  addConnection: (conn: ConnectionConfig) => void;
  updateConnection: (conn: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string | null) => void;
}

const DEV_TEST_CONNECTIONS: ConnectionConfig[] = [
  {
    id: 'dev-supabase-test',
    name: 'Supabase Test',
    engine: 'postgres',
    host: 'db.jokybdfzvuzunnionczq.supabase.co',
    port: 5432,
    user: 'postgres',
    password: 'wBTUQkRyrwbZXVcV',
    database: 'postgres',
    connectTimeoutSeconds: 10,
    autoReconnect: true,
    postgresSslMode: 'require',
    ssh: {
      enabled: false,
    },
  },
  {
    id: 'dev-oracle-test',
    name: 'Oracle Test',
    engine: 'oracle',
    host: 'localhost',
    port: 7001,
    user: 'CORE_DEVELOPMENT',
    password: 'DevPass2024',
    database: 'ORCL',
    connectTimeoutSeconds: 10,
    autoReconnect: true,
    oracleConnectionType: 'serviceName',
    ssh: {
      enabled: false,
    },
  },
];

export const useConnectionsStore = create<ConnectionsState>((set) => ({
  connections: normalizeConnections(JSON.parse(localStorage.getItem('connections') || '[]')),
  activeConnectionId: null,
  addConnection: (conn) =>
    set((state) => {
      const newConns = [...state.connections, conn];
      localStorage.setItem('connections', JSON.stringify(newConns));
      return { connections: newConns };
    }),
  updateConnection: (conn) =>
    set((state) => {
      const newConns = state.connections.map((current) => (current.id === conn.id ? conn : current));
      localStorage.setItem('connections', JSON.stringify(newConns));
      return {
        connections: newConns,
      };
    }),
  removeConnection: (id) =>
    set((state) => {
      const newConns = state.connections.filter((c) => c.id !== id);
      localStorage.setItem('connections', JSON.stringify(newConns));
      return { 
        connections: newConns,
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId
      };
    }),
  setActiveConnection: (id) => set({ activeConnectionId: id }),
}));

function normalizeConnections(input: unknown): ConnectionConfig[] {
  const normalized = Array.isArray(input)
    ? input
        .map((item) => normalizeConnection(item))
        .filter((item): item is ConnectionConfig => item !== null)
    : [];

  return ensureDevTestConnections(normalized);
}

function normalizeConnection(input: unknown): ConnectionConfig | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const raw = input as Record<string, unknown>;
  const sshEnabled = Boolean(raw.useSsh) || Boolean((raw.ssh as { enabled?: boolean } | undefined)?.enabled);
  const ssh = raw.ssh && typeof raw.ssh === 'object'
    ? raw.ssh as Record<string, unknown>
    : undefined;

  return {
    id: String(raw.id ?? crypto.randomUUID()),
    name: String(raw.name ?? 'Connection'),
    engine: raw.engine === 'mysql' || raw.engine === 'oracle' ? raw.engine : 'postgres',
    host: String(raw.host ?? 'localhost'),
    port: Number(raw.port ?? (raw.engine === 'mysql' ? 3306 : 5432)),
    user: String(raw.user ?? ''),
    password: typeof raw.password === 'string' ? raw.password : undefined,
    database: String(raw.database ?? raw.dbname ?? ''),
    connectTimeoutSeconds: normalizeTimeout(raw.connectTimeoutSeconds),
    autoReconnect: typeof raw.autoReconnect === 'boolean' ? raw.autoReconnect : true,
    postgresSslMode: normalizePostgresSslMode(raw.postgresSslMode),
    oracleConnectionType: raw.oracleConnectionType === 'sid' ? 'sid' : 'serviceName',
    oracleDriverProperties: asOptionalString(raw.oracleDriverProperties),
    ssh: {
      enabled: sshEnabled,
      host: asOptionalString(ssh?.host ?? raw.sshHost),
      port: asOptionalNumber(ssh?.port ?? raw.sshPort) ?? 22,
      user: asOptionalString(ssh?.user ?? raw.sshUser),
      authMethod: (ssh?.authMethod === 'privateKey' ? 'privateKey' : 'password'),
      password: asOptionalString(ssh?.password ?? raw.sshPassword),
      privateKeyPath: asOptionalString(ssh?.privateKeyPath),
      passphrase: asOptionalString(ssh?.passphrase),
    },
  };
}

function normalizeTimeout(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(120, Math.max(3, Math.round(value)));
  }

  return 10;
}

function normalizePostgresSslMode(value: unknown): PostgresSslMode {
  if (value === 'disable' || value === 'require') {
    return value;
  }

  return 'prefer';
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function ensureDevTestConnections(connections: ConnectionConfig[]): ConnectionConfig[] {
  if (!import.meta.env.DEV) {
    return connections;
  }

  const seeded = [...connections];

  for (const testConnection of DEV_TEST_CONNECTIONS) {
    const exists = seeded.some(
      (connection) =>
        connection.id === testConnection.id ||
        (connection.host === testConnection.host &&
          connection.port === testConnection.port &&
          connection.user === testConnection.user &&
          connection.database === testConnection.database),
    );

    if (!exists) {
      seeded.unshift(testConnection);
    }
  }

  return seeded;
}
