export interface SqlTableReference {
  schemaName?: string;
  tableName: string;
  tableRef: string;
  alias?: string;
}

export interface SqlAliasTarget extends SqlTableReference {
  alias: string;
}

export interface ParsedSqlAliases {
  aliases: Map<string, SqlAliasTarget>;
  tables: SqlTableReference[];
}

const SQL_KEYWORDS = new Set([
  'and',
  'as',
  'cross',
  'full',
  'group',
  'having',
  'inner',
  'join',
  'left',
  'limit',
  'on',
  'order',
  'right',
  'where',
]);

const IDENTIFIER = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const TABLE_REFERENCE_PATTERN = new RegExp(
  String.raw`\b(?:from|join)\s+(${IDENTIFIER}(?:\.${IDENTIFIER})?)(?:\s+(?:as\s+)?(${IDENTIFIER}))?`,
  'gi',
);

export function parseSimpleAliases(sqlText: string): ParsedSqlAliases {
  const aliases = new Map<string, SqlAliasTarget>();
  const tables: SqlTableReference[] = [];
  let match: RegExpExecArray | null;

  while ((match = TABLE_REFERENCE_PATTERN.exec(sqlText)) !== null) {
    const tableRef = normalizeIdentifier(match[1] ?? '');
    const alias = normalizeIdentifier(match[2] ?? '');

    if (!tableRef) {
      continue;
    }

    const parts = tableRef.split('.');
    const tableName = parts[parts.length - 1] ?? tableRef;
    const schemaName = parts.length > 1 ? parts[parts.length - 2] : undefined;
    const table: SqlTableReference = {
      schemaName,
      tableName,
      tableRef,
      alias: isValidAlias(alias) ? alias : undefined,
    };

    tables.push(table);

    if (table.alias) {
      aliases.set(table.alias.toLowerCase(), {
        ...table,
        alias: table.alias,
      });
    }
  }

  return { aliases, tables };
}

function normalizeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function isValidAlias(value: string): boolean {
  return Boolean(value) && !SQL_KEYWORDS.has(value.toLowerCase());
}
