import { invoke } from '@tauri-apps/api/core';
import { type DatabaseEngine, useConnectionsStore } from '../../store/connections';
import { useConnectionRuntimeStore } from '../../store/connectionRuntime';
import { useDatabaseSessionStore } from '../../store/databaseSession';
import type { ColumnDef, MetadataColumn } from './types';
import { normalizeColumnDef } from './types';

const inFlightRequests = new Map<string, Promise<unknown>>();

export async function ensureSchemasCached(
  connectionId: string,
  engine: DatabaseEngine,
  options?: { force?: boolean; markActive?: boolean },
): Promise<string[]> {
  const state = useDatabaseSessionStore.getState();
  const cached = state.metadataByConnection[connectionId];
  if (cached?.schemas.length && !options?.force) {
    if (options?.markActive && !state.activeSchemaByConnection[connectionId]) {
      state.setActiveSchema(connectionId, resolvePreferredSchema(connectionId, cached.schemas));
    }
    return cached.schemas;
  }

  const key = `schemas:${connectionId}`;
  return reuseRequest(key, async () => {
    // Try SQLite local cache first (skip on force refresh)
    if (!options?.force) {
      try {
        const localSchemas = await invoke<string[]>('get_local_schemas', { configId: connectionId });
        if (localSchemas.length > 0) {
          useDatabaseSessionStore.getState().cacheSchemas(connectionId, engine, localSchemas);
          const activeSchema = useDatabaseSessionStore.getState().activeSchemaByConnection[connectionId];
          if ((options?.markActive || !activeSchema) && localSchemas.length) {
            useDatabaseSessionStore
              .getState()
              .setActiveSchema(connectionId, activeSchema ?? resolvePreferredSchema(connectionId, localSchemas));
          }
          useConnectionRuntimeStore
            .getState()
            .appendLog(connectionId, `Schema metadata loaded from local cache (${localSchemas.length} schemas).`);
          return localSchemas;
        }
      } catch {
        // SQLite unavailable — fall through to remote
      }
    }

    const startedAt = performance.now();
    useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
      phase: 'loadingSchemas',
      message: 'Carregando schemas',
    });

    try {
      const schemas = await invoke<string[]>('list_schemas', { connId: connectionId });
      useDatabaseSessionStore.getState().cacheSchemas(connectionId, engine, schemas);

      const activeSchema = useDatabaseSessionStore.getState().activeSchemaByConnection[connectionId];
      if ((options?.markActive || !activeSchema) && schemas.length) {
        useDatabaseSessionStore
          .getState()
          .setActiveSchema(connectionId, activeSchema ?? resolvePreferredSchema(connectionId, schemas));
      }

      // Persist to SQLite (fire-and-forget)
      void invoke('save_local_schemas', { configId: connectionId, schemas });

      useConnectionRuntimeStore
        .getState()
        .appendLog(connectionId, `Schema metadata loaded in ${Math.round(performance.now() - startedAt)}ms.`);
      useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
        phase: 'idle',
      });

      return schemas;
    } catch (error) {
      const message = formatMetadataError(error, 'Failed to load schemas.');
      useDatabaseSessionStore.getState().setSchemasError(connectionId, engine, message);
      useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
        phase: 'idle',
        message,
      });
      useConnectionRuntimeStore.getState().appendLog(connectionId, message);
      throw new Error(message);
    }
  }) as Promise<string[]>;
}

function resolvePreferredSchema(connectionId: string, schemas: string[]): string | null {
  if (!schemas.length) {
    return null;
  }

  const connection = useConnectionsStore.getState().connections.find((item) => item.id === connectionId);
  const preferredCandidates = [connection?.preferredSchema, connection?.user]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  for (const candidate of preferredCandidates) {
    const match = schemas.find((schema) => schema.localeCompare(candidate, undefined, { sensitivity: 'accent' }) === 0);
    if (match) {
      return match;
    }
  }

  return schemas[0] ?? null;
}

export async function ensureTablesCached(
  connectionId: string,
  engine: DatabaseEngine,
  schemaName: string,
  options?: { force?: boolean },
): Promise<string[]> {
  const state = useDatabaseSessionStore.getState();
  const cachedSchema = state.metadataByConnection[connectionId]?.schemasByName[schemaName];
  if (cachedSchema?.tables.length && !options?.force) {
    return cachedSchema.tables;
  }

  const key = `tables:${connectionId}:${schemaName}`;
  return reuseRequest(key, async () => {
    // Try SQLite local cache first (skip on force refresh)
    if (!options?.force) {
      try {
        const localTables = await invoke<string[]>('get_local_tables', {
          configId: connectionId,
          schemaName,
        });
        if (localTables.length > 0) {
          useDatabaseSessionStore.getState().cacheTables(connectionId, engine, schemaName, localTables);
          useConnectionRuntimeStore
            .getState()
            .appendLog(connectionId, `Table metadata for ${schemaName} loaded from local cache (${localTables.length} tables).`);
          // Prefetch columns from SQLite/remote in background for autocomplete
          void prefetchColumnsBackground(connectionId, engine, schemaName, localTables);
          return localTables;
        }
      } catch {
        // SQLite unavailable — fall through to remote
      }
    }

    const startedAt = performance.now();
    useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
      phase: 'loadingTables',
      schemaName,
      message: `Carregando tabelas de ${schemaName}`,
    });

    try {
      const tables = await invoke<string[]>('list_tables', { connId: connectionId, schema: schemaName });
      useDatabaseSessionStore.getState().cacheTables(connectionId, engine, schemaName, tables);

      // Persist to SQLite (fire-and-forget)
      void invoke('save_local_tables', { configId: connectionId, schemaName, tables });

      useConnectionRuntimeStore
        .getState()
        .appendLog(connectionId, `Table metadata for ${schemaName} loaded in ${Math.round(performance.now() - startedAt)}ms.`);
      useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
        phase: 'idle',
      });

      // Prefetch columns from remote in background for autocomplete
      void prefetchColumnsBackground(connectionId, engine, schemaName, tables);

      return tables;
    } catch (error) {
      const message = formatMetadataError(error, `Failed to load tables for ${schemaName}.`);
      useDatabaseSessionStore.getState().setTablesError(connectionId, engine, schemaName, message);
      useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
        phase: 'idle',
        schemaName,
        message,
      });
      useConnectionRuntimeStore.getState().appendLog(connectionId, message);
      throw new Error(message);
    }
  }) as Promise<string[]>;
}

export async function ensureColumnsCached(
  connectionId: string,
  engine: DatabaseEngine,
  schemaName: string,
  tableName: string,
  options?: { force?: boolean },
): Promise<MetadataColumn[]> {
  const state = useDatabaseSessionStore.getState();
  const cachedColumns = state.metadataByConnection[connectionId]?.schemasByName[schemaName]?.tablesByName[tableName]?.columns;
  if (cachedColumns?.length && !options?.force) {
    return cachedColumns;
  }

  const key = `columns:${connectionId}:${schemaName}:${tableName}`;
  return reuseRequest(key, async () => {
    // Try SQLite local cache first (skip on force refresh)
    if (!options?.force) {
      try {
        const localColumns = await invoke<ColumnDef[]>('get_local_columns', {
          configId: connectionId,
          schemaName,
          tableName,
        });
        if (localColumns.length > 0) {
          const normalized = localColumns.map(normalizeColumnDef);
          useDatabaseSessionStore.getState().cacheColumns(connectionId, engine, schemaName, tableName, normalized);
          useConnectionRuntimeStore
            .getState()
            .appendLog(connectionId, `Column metadata for ${schemaName}.${tableName} loaded from local cache.`);
          return normalized;
        }
      } catch {
        // SQLite unavailable — fall through to remote
      }
    }

    const startedAt = performance.now();
    useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
      phase: 'loadingColumns',
      schemaName,
      tableName,
      message: `Carregando colunas de ${schemaName}.${tableName}`,
    });

    try {
      const columns = await invoke<ColumnDef[]>('list_columns', {
        connId: connectionId,
        schema: schemaName,
        table: tableName,
      });
      const normalized = columns.map(normalizeColumnDef);
      useDatabaseSessionStore.getState().cacheColumns(connectionId, engine, schemaName, tableName, normalized);

      // Persist raw columns to SQLite (fire-and-forget)
      void invoke('save_local_columns', { configId: connectionId, schemaName, tableName, columns });

      useConnectionRuntimeStore
        .getState()
        .appendLog(connectionId, `Column metadata for ${schemaName}.${tableName} loaded in ${Math.round(performance.now() - startedAt)}ms.`);
      useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
        phase: 'idle',
      });
      return normalized;
    } catch (error) {
      const message = formatMetadataError(error, `Failed to load columns for ${schemaName}.${tableName}.`);
      useDatabaseSessionStore.getState().setColumnsError(connectionId, engine, schemaName, tableName, message);
      useDatabaseSessionStore.getState().setMetadataActivity(connectionId, {
        phase: 'idle',
        schemaName,
        tableName,
        message,
      });
      useConnectionRuntimeStore.getState().appendLog(connectionId, message);
      throw new Error(message);
    }
  }) as Promise<MetadataColumn[]>;
}

export function invalidateMetadataCache(connectionId: string) {
  useDatabaseSessionStore.getState().invalidateConnection(connectionId);
  // Clear SQLite cache (fire-and-forget)
  void invoke('invalidate_local_metadata', { configId: connectionId });
  useConnectionRuntimeStore.getState().appendLog(connectionId, 'Metadata cache invalidated.');
}

export function getCachedTableNames(connectionId: string, activeSchema?: string | null): string[] {
  const metadata = useDatabaseSessionStore.getState().metadataByConnection[connectionId];
  if (!metadata) {
    return [];
  }

  const seen = new Set<string>();
  const values: string[] = [];

  if (activeSchema) {
    for (const table of metadata.schemasByName[activeSchema]?.tables ?? []) {
      if (!seen.has(table)) {
        seen.add(table);
        values.push(table);
      }
    }
  }

  for (const schemaName of metadata.schemas) {
    if (schemaName === activeSchema) {
      continue;
    }

    for (const table of metadata.schemasByName[schemaName]?.tables ?? []) {
      if (!seen.has(table)) {
        seen.add(table);
        values.push(table);
      }
    }
  }

  return values;
}

export function getCachedColumns(
  connectionId: string,
  schemaName: string,
  tableName: string,
): MetadataColumn[] {
  return (
    useDatabaseSessionStore.getState().metadataByConnection[connectionId]?.schemasByName[schemaName]
      ?.tablesByName[tableName]?.columns ?? []
  );
}

async function prefetchColumnsBackground(
  connectionId: string,
  engine: DatabaseEngine,
  schemaName: string,
  tables: string[],
): Promise<void> {
  for (const tableName of tables.slice(0, 60)) {
    try {
      await ensureColumnsCached(connectionId, engine, schemaName, tableName);
    } catch {
      // ignore individual failures
    }
  }
}

function reuseRequest<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const current = inFlightRequests.get(key) as Promise<T> | undefined;
  if (current) {
    return current;
  }

  const request = factory().finally(() => {
    inFlightRequests.delete(key);
  });
  inFlightRequests.set(key, request);
  return request;
}

function formatMetadataError(error: unknown, fallback: string): string {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
