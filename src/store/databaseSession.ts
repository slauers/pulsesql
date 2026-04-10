import { create } from 'zustand';
import type { DatabaseEngine } from './connections';
import type { MetadataColumn, MetadataConnectionEntry } from '../features/database/types';

interface DatabaseSessionState {
  activeSchemaByConnection: Record<string, string | null>;
  metadataByConnection: Record<string, MetadataConnectionEntry>;
  metadataActivityByConnection: Record<
    string,
    {
      phase: 'idle' | 'loadingSchemas' | 'loadingTables' | 'loadingColumns';
      schemaName?: string | null;
      tableName?: string | null;
      message?: string | null;
    }
  >;
  setActiveSchema: (connectionId: string, schemaName: string | null) => void;
  setMetadataActivity: (
    connectionId: string,
    activity: {
      phase: 'idle' | 'loadingSchemas' | 'loadingTables' | 'loadingColumns';
      schemaName?: string | null;
      tableName?: string | null;
      message?: string | null;
    },
  ) => void;
  cacheSchemas: (connectionId: string, engine: DatabaseEngine, schemas: string[]) => void;
  cacheTables: (connectionId: string, engine: DatabaseEngine, schemaName: string, tables: string[]) => void;
  cacheColumns: (
    connectionId: string,
    engine: DatabaseEngine,
    schemaName: string,
    tableName: string,
    columns: MetadataColumn[],
  ) => void;
  setSchemasError: (connectionId: string, engine: DatabaseEngine, error: string | null) => void;
  setTablesError: (connectionId: string, engine: DatabaseEngine, schemaName: string, error: string | null) => void;
  setColumnsError: (
    connectionId: string,
    engine: DatabaseEngine,
    schemaName: string,
    tableName: string,
    error: string | null,
  ) => void;
  invalidateConnection: (connectionId: string) => void;
}

const ACTIVE_SCHEMA_STORAGE_KEY = 'active-schema-by-connection';

export const useDatabaseSessionStore = create<DatabaseSessionState>((set) => ({
  activeSchemaByConnection: readActiveSchemaState(),
  metadataByConnection: {},
  metadataActivityByConnection: {},
  setActiveSchema: (connectionId, schemaName) =>
    set((current) => {
      const next = {
        ...current.activeSchemaByConnection,
        [connectionId]: schemaName,
      };
      writeActiveSchemaState(next);
      return {
        activeSchemaByConnection: next,
      };
    }),
  setMetadataActivity: (connectionId, activity) =>
    set((current) => ({
      metadataActivityByConnection: {
        ...current.metadataActivityByConnection,
        [connectionId]: activity,
      },
    })),
  cacheSchemas: (connectionId, engine, schemas) =>
    set((current) => {
      const connection = ensureConnectionEntry(current.metadataByConnection[connectionId], connectionId, engine);
      const schemasByName = { ...connection.schemasByName };

      for (const schemaName of schemas) {
        schemasByName[schemaName] = ensureSchemaEntry(schemasByName[schemaName], schemaName);
      }

      return {
        metadataByConnection: {
          ...current.metadataByConnection,
          [connectionId]: {
            ...connection,
            engine,
            schemas: [...schemas],
            schemasLoadedAt: Date.now(),
            schemasError: null,
            schemasByName,
          },
        },
      };
    }),
  cacheTables: (connectionId, engine, schemaName, tables) =>
    set((current) => {
      const connection = ensureConnectionEntry(current.metadataByConnection[connectionId], connectionId, engine);
      const schema = ensureSchemaEntry(connection.schemasByName[schemaName], schemaName);
      const tablesByName = { ...schema.tablesByName };

      for (const tableName of tables) {
        tablesByName[tableName] = ensureTableEntry(tablesByName[tableName], tableName);
      }

      return {
        metadataByConnection: {
          ...current.metadataByConnection,
          [connectionId]: {
            ...connection,
            engine,
            schemasByName: {
              ...connection.schemasByName,
              [schemaName]: {
                ...schema,
                tables: [...tables],
                tablesLoadedAt: Date.now(),
                tablesError: null,
                tablesByName,
              },
            },
          },
        },
      };
    }),
  cacheColumns: (connectionId, engine, schemaName, tableName, columns) =>
    set((current) => {
      const connection = ensureConnectionEntry(current.metadataByConnection[connectionId], connectionId, engine);
      const schema = ensureSchemaEntry(connection.schemasByName[schemaName], schemaName);
      const table = ensureTableEntry(schema.tablesByName[tableName], tableName);

      return {
        metadataByConnection: {
          ...current.metadataByConnection,
          [connectionId]: {
            ...connection,
            engine,
            schemasByName: {
              ...connection.schemasByName,
              [schemaName]: {
                ...schema,
                tablesByName: {
                  ...schema.tablesByName,
                  [tableName]: {
                    ...table,
                    columns: [...columns],
                    columnsLoadedAt: Date.now(),
                    columnsError: null,
                  },
                },
              },
            },
          },
        },
      };
    }),
  setSchemasError: (connectionId, engine, error) =>
    set((current) => {
      const connection = ensureConnectionEntry(current.metadataByConnection[connectionId], connectionId, engine);
      return {
        metadataByConnection: {
          ...current.metadataByConnection,
          [connectionId]: {
            ...connection,
            schemasError: error,
          },
        },
      };
    }),
  setTablesError: (connectionId, engine, schemaName, error) =>
    set((current) => {
      const connection = ensureConnectionEntry(current.metadataByConnection[connectionId], connectionId, engine);
      const schema = ensureSchemaEntry(connection.schemasByName[schemaName], schemaName);

      return {
        metadataByConnection: {
          ...current.metadataByConnection,
          [connectionId]: {
            ...connection,
            schemasByName: {
              ...connection.schemasByName,
              [schemaName]: {
                ...schema,
                tablesError: error,
              },
            },
          },
        },
      };
    }),
  setColumnsError: (connectionId, engine, schemaName, tableName, error) =>
    set((current) => {
      const connection = ensureConnectionEntry(current.metadataByConnection[connectionId], connectionId, engine);
      const schema = ensureSchemaEntry(connection.schemasByName[schemaName], schemaName);
      const table = ensureTableEntry(schema.tablesByName[tableName], tableName);

      return {
        metadataByConnection: {
          ...current.metadataByConnection,
          [connectionId]: {
            ...connection,
            schemasByName: {
              ...connection.schemasByName,
              [schemaName]: {
                ...schema,
                tablesByName: {
                  ...schema.tablesByName,
                  [tableName]: {
                    ...table,
                    columnsError: error,
                  },
                },
              },
            },
          },
        },
      };
    }),
  invalidateConnection: (connectionId) =>
    set((current) => {
      const metadataByConnection = { ...current.metadataByConnection };
      const activeSchemaByConnection = { ...current.activeSchemaByConnection };
      const metadataActivityByConnection = { ...current.metadataActivityByConnection };
      delete metadataByConnection[connectionId];
      delete activeSchemaByConnection[connectionId];
      delete metadataActivityByConnection[connectionId];
      writeActiveSchemaState(activeSchemaByConnection);
      return { metadataByConnection, activeSchemaByConnection, metadataActivityByConnection };
    }),
}));

function ensureConnectionEntry(
  current: MetadataConnectionEntry | undefined,
  connectionId: string,
  engine: DatabaseEngine,
): MetadataConnectionEntry {
  return current ?? {
    connectionId,
    engine,
    schemas: [],
    schemasByName: {},
  };
}

function ensureSchemaEntry(
  current: MetadataConnectionEntry['schemasByName'][string] | undefined,
  schemaName: string,
) {
  return current ?? {
    name: schemaName,
    tables: [],
    tablesByName: {},
  };
}

function ensureTableEntry(
  current: MetadataConnectionEntry['schemasByName'][string]['tablesByName'][string] | undefined,
  tableName: string,
) {
  return current ?? {
    name: tableName,
  };
}

function readActiveSchemaState(): Record<string, string | null> {
  try {
    const raw = localStorage.getItem(ACTIVE_SCHEMA_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeActiveSchemaState(value: Record<string, string | null>) {
  try {
    localStorage.setItem(ACTIVE_SCHEMA_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Persistencia de sessao nao deve quebrar a aplicacao.
  }
}
