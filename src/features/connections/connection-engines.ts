import type { ConnectionConfig, DatabaseEngine } from '../../store/connections';

export interface EngineDefinition {
  id: DatabaseEngine;
  label: string;
  defaultPort: number;
  defaultDatabase: string;
  defaultHost: string;
  defaultUser: string;
  placeholderHost: string;
  placeholderDatabase: string;
  databaseLabel: string;
}

export const ENGINE_DEFINITIONS: Record<DatabaseEngine, EngineDefinition> = {
  postgres: {
    id: 'postgres',
    label: 'PostgreSQL',
    defaultPort: 5432,
    defaultDatabase: 'postgres',
    defaultHost: 'localhost',
    defaultUser: 'postgres',
    placeholderHost: 'localhost',
    placeholderDatabase: 'postgres',
    databaseLabel: 'Database',
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    defaultPort: 3306,
    defaultDatabase: '',
    defaultHost: 'localhost',
    defaultUser: 'root',
    placeholderHost: 'localhost',
    placeholderDatabase: 'mysql',
    databaseLabel: 'Database',
  },
  oracle: {
    id: 'oracle',
    label: 'Oracle',
    defaultPort: 1521,
    defaultDatabase: 'ORCL',
    defaultHost: 'localhost',
    defaultUser: 'system',
    placeholderHost: 'localhost',
    placeholderDatabase: 'ORCL',
    databaseLabel: 'Service Name',
  },
};

export function getEngineFieldDefaults(engine: DatabaseEngine) {
  const definition = ENGINE_DEFINITIONS[engine];

  return {
    host: definition.defaultHost,
    port: definition.defaultPort,
    database: definition.defaultDatabase,
    user: definition.defaultUser,
  };
}

export function createDefaultConnectionForm(engine: DatabaseEngine = 'postgres'): Partial<ConnectionConfig> {
  const fieldDefaults = getEngineFieldDefaults(engine);

  return {
    name:
      engine === 'postgres'
        ? 'Local Postgres'
        : engine === 'mysql'
          ? 'Local MySQL'
          : 'Local Oracle',
    engine,
    host: fieldDefaults.host,
    port: fieldDefaults.port,
    user: fieldDefaults.user,
    database: fieldDefaults.database,
    connectTimeoutSeconds: 10,
    autoReconnect: true,
    postgresSslMode: engine === 'postgres' ? 'prefer' : undefined,
    oracleConnectionType: 'serviceName',
    oracleDriverProperties: '',
    password: '',
    ssh: {
      enabled: false,
      host: '',
      port: 22,
      user: '',
      authMethod: 'password',
      password: '',
      privateKeyPath: '',
      passphrase: '',
    },
  };
}
