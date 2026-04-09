# Query History V2 - Blacktable

## Objetivo

Implementar um histórico de queries executadas no Blacktable que permita:

- lembrar o que foi executado
- buscar execuções antigas rapidamente
- reabrir ou reexecutar SQL com um clique
- manter a interface principal limpa

O foco é memória útil de trabalho, não arquivo morto de SQL.

## Contexto

O Blacktable hoje já tem:

- editor SQL com múltiplas abas
- execução de query no backend Tauri
- suporte a múltiplos bancos
- logs e estado de conexão

O que ainda não existe:

- persistência de queries executadas
- busca e filtro de execuções passadas
- reuso rápido de SQL já executado

Observação importante:

- a proposta original cita backend em Go, mas o projeto real usa `Rust + Tauri`
- a persistência correta para este projeto deve ser um SQLite local acessado pelo backend Rust

## Regra de negócio

Salvar no histórico apenas execuções iniciadas manualmente pelo usuário.

Devem entrar no histórico:

- execução normal via `Run`
- execução de seleção ou script inteiro, quando esse fluxo existir
- execuções com sucesso
- execuções com erro
- execuções canceladas, quando cancelamento existir

Não devem entrar no histórico:

- pings de conexão
- testes de conexão
- metadata queries internas do app
- queries automáticas de explorer
- health checks

Cada item do histórico representa uma execução, não uma aba.

Diferença conceitual:

- tabs persistidas guardam rascunho/sessão
- history guarda o que foi executado

## Dados e integrações

### Modelo

```ts
type QueryHistoryStatus = 'success' | 'error' | 'cancelled';

type QueryHistoryItem = {
  id: string;
  connectionId: string;
  connectionName: string;
  databaseName?: string;
  schemaName?: string;
  queryText: string;
  executedAt: string;
  durationMs?: number;
  status: QueryHistoryStatus;
  errorMessage?: string;
  rowCount?: number;
};
```

### SQLite local

Tabela sugerida:

```sql
CREATE TABLE IF NOT EXISTS query_history (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  connection_name TEXT NOT NULL,
  database_name TEXT,
  schema_name TEXT,
  query_text TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  error_message TEXT,
  row_count INTEGER
);

CREATE INDEX IF NOT EXISTS idx_query_history_executed_at
ON query_history (executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_query_history_connection_id
ON query_history (connection_id);

CREATE INDEX IF NOT EXISTS idx_query_history_status
ON query_history (status);
```

### Política de retenção

Primeiro corte:

- manter no máximo `2000` registros
- ao inserir um novo, remover excedente mais antigo

### Filtro de listagem

```ts
type QueryHistoryFilter = {
  query?: string;
  connectionId?: string;
  status?: 'success' | 'error' | 'cancelled';
  limit?: number;
  offset?: number;
};
```

## Permissões

Não existe camada de permissões/roles no projeto hoje.

Regras de segurança:

- histórico é local ao usuário da máquina
- não salvar credenciais junto do histórico
- não salvar metadata interna de infraestrutura

## Critérios de aceite

1. Cada execução manual de query gera um item de histórico local.
2. Histórico salva `success`, `error` e `cancelled`.
3. O painel de histórico abre sem poluir a tela principal.
4. O histórico lista os itens mais recentes primeiro.
5. Busca por texto em `query_text` funciona.
6. Filtro por conexão funciona.
7. Filtro por status funciona.
8. Ações por item:
   - Open in new tab
   - Replace current editor
   - Copy SQL
   - Run again
   - Delete
9. Existe ação de limpar histórico com confirmação.
10. Retenção automática de no máximo `2000` itens está ativa.
11. Queries internas do app não entram no histórico.

## Impacto técnico

### Frontend

Adicionar uma feature isolada de histórico, idealmente como drawer lateral direito.

Estado necessário:

- painel aberto/fechado
- busca
- filtro por conexão
- filtro por status
- loading
- itens carregados

Integrações com editor:

- abrir item em nova aba
- substituir aba atual
- copiar SQL
- reexecutar

### Backend

Adicionar módulo de histórico no backend Tauri:

- inicialização do banco SQLite local
- criação da tabela
- insert
- list com filtros
- delete item
- clear history
- retenção automática

### Core

O fluxo de execução de query precisa chamar a persistência do histórico no final da execução.

Ordem correta:

1. executar query
2. montar resultado ou erro
3. salvar item no histórico
4. responder ao frontend

## Arquivos prováveis

### Frontend

- `/Users/saulolauers/Projects/blacktable/src/features/history/types.ts`
- `/Users/saulolauers/Projects/blacktable/src/features/history/services/historyService.ts`
- `/Users/saulolauers/Projects/blacktable/src/features/history/hooks/useQueryHistory.ts`
- `/Users/saulolauers/Projects/blacktable/src/features/history/components/QueryHistoryDrawer.tsx`
- `/Users/saulolauers/Projects/blacktable/src/features/history/components/QueryHistoryFilters.tsx`
- `/Users/saulolauers/Projects/blacktable/src/features/history/components/QueryHistoryList.tsx`
- `/Users/saulolauers/Projects/blacktable/src/features/history/components/QueryHistoryItem.tsx`
- `/Users/saulolauers/Projects/blacktable/src/store/queries.ts`
- `/Users/saulolauers/Projects/blacktable/src/features/query/QueryWorkspace.tsx`
- `/Users/saulolauers/Projects/blacktable/src/App.tsx`

### Backend

- `/Users/saulolauers/Projects/blacktable/src-tauri/src/history/mod.rs`
- `/Users/saulolauers/Projects/blacktable/src-tauri/src/history/model.rs`
- `/Users/saulolauers/Projects/blacktable/src-tauri/src/history/repository.rs`
- `/Users/saulolauers/Projects/blacktable/src-tauri/src/history/service.rs`
- `/Users/saulolauers/Projects/blacktable/src-tauri/src/lib.rs`
- `/Users/saulolauers/Projects/blacktable/src-tauri/src/db.rs`
- `/Users/saulolauers/Projects/blacktable/src-tauri/Cargo.toml`

## Arquitetura sugerida

### Backend Rust

Estrutura:

```text
src-tauri/src/history/
  mod.rs
  model.rs
  repository.rs
  service.rs
```

Responsabilidades:

- `model.rs`
  - tipos do histórico
- `repository.rs`
  - SQL e acesso ao SQLite
- `service.rs`
  - regras de retenção e listagem
- `mod.rs`
  - exports

### Comandos Tauri

Sugestão:

- `list_query_history`
- `delete_query_history_item`
- `clear_query_history`

Não precisa expor `save_query_history` para o frontend.

O save deve acontecer internamente no fluxo de execução.

## UX recomendada

Padrão certo para este projeto:

- drawer lateral direito
- largura entre `320px` e `380px`
- fechado por padrão
- abertura por botão discreto perto do editor
- atalho `Cmd/Ctrl + Shift + H`

Cada item mostra:

- snippet da primeira linha da query
- conexão
- data/hora
- status
- duração

Estados:

- `success` verde suave
- `error` vermelho suave
- `cancelled` cinza/âmbar discreto

Não transformar histórico em grid.

## MVP recomendado

### Sprint 1

- SQLite local
- salvar execuções
- listar últimos 50
- drawer simples
- Open in new tab
- Copy SQL
- Run again

### Sprint 2

- busca por texto
- filtro por conexão
- filtro por status
- Replace current editor
- Delete item

### Sprint 3

- Clear history
- retenção automática
- preview expandido
- atalho para abrir drawer

## Riscos

1. Misturar histórico com tabs persistidas e criar confusão conceitual.
2. Salvar queries internas do app e poluir a feature.
3. Transformar o histórico em tabela pesada e matar a clareza.
4. Colocar modal em vez de drawer e piorar o fluxo.
5. Acoplar demais a UI do histórico ao query runner atual.

## Ordem recomendada de implementação

1. backend SQLite + tabela + repository
2. integração do save no fluxo de execução
3. listagem simples no frontend
4. drawer lateral direito
5. ações rápidas por item
6. busca/filtros
7. retenção e clear
