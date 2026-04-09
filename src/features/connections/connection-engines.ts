import type { ConnectionConfig, DatabaseEngine } from '../../store/connections';

export interface EngineDefinition {
  id: DatabaseEngine;
  label: string;
  defaultPort: number;
  defaultDatabase: string;
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
    placeholderHost: 'localhost',
    placeholderDatabase: 'postgres',
    databaseLabel: 'Database',
  },
  mysql: {
    id: 'mysql',
    label: 'MySQL',
    defaultPort: 3306,
    defaultDatabase: '',
    placeholderHost: 'localhost',
    placeholderDatabase: 'mysql',
    databaseLabel: 'Database',
  },
  oracle: {
    id: 'oracle',
    label: 'Oracle',
    defaultPort: 1521,
    defaultDatabase: 'FREEPDB1',
    placeholderHost: 'localhost',
    placeholderDatabase: 'FREEPDB1',
    databaseLabel: 'Service Name',
  },
};

export function createDefaultConnectionForm(engine: DatabaseEngine = 'postgres'): Partial<ConnectionConfig> {
  const definition = ENGINE_DEFINITIONS[engine];

  return {
    name:
      engine === 'postgres'
        ? 'Local Postgres'
        : engine === 'mysql'
          ? 'Local MySQL'
          : 'Local Oracle',
    engine,
    host: definition.placeholderHost,
    port: definition.defaultPort,
    user: engine === 'postgres' ? 'postgres' : engine === 'mysql' ? 'root' : 'system',
    database: definition.defaultDatabase,
    connectTimeoutSeconds: 10,
    autoReconnect: true,
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
