export interface SqlKeywordDefinition {
  label: string;
  insertText: string;
}

export const SELECT_FROM_TABLE_SNIPPET = {
  label: 'SELECT * FROM table',
  detail: 'Template',
  insertText: 'SELECT * FROM ${1:table_name};$0',
};

export const SQL_KEYWORDS: SqlKeywordDefinition[] = [
  { label: 'SELECT', insertText: 'SELECT' },
  { label: 'FROM', insertText: 'FROM' },
  { label: 'WHERE', insertText: 'WHERE' },
  { label: 'JOIN', insertText: 'JOIN' },
  { label: 'LEFT JOIN', insertText: 'LEFT JOIN' },
  { label: 'INNER JOIN', insertText: 'INNER JOIN' },
  { label: 'ORDER BY', insertText: 'ORDER BY' },
  { label: 'GROUP BY', insertText: 'GROUP BY' },
  { label: 'LIMIT', insertText: 'LIMIT' },
  { label: 'INSERT', insertText: 'INSERT' },
  { label: 'UPDATE', insertText: 'UPDATE' },
  { label: 'DELETE', insertText: 'DELETE' },
];
