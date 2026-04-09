# Plano de Implementação: Fase 1

## Escopo da fase 1

Entregar uma base funcional e segura para:

- suportar `Postgres` e `MySQL` no cadastro de conexão,
- suportar SSH com `password` e `private key`,
- manter compatibilidade com o fluxo atual de query runner,
- preservar explorer completo inicialmente apenas para `Postgres`,
- preparar a arquitetura para `Oracle` sem implementar Oracle ainda.

Fora de escopo nesta fase:

- download real de driver Oracle,
- explorer multi-engine completo,
- suporte a jump host,
- host key verification avançada,
- import/export de conexões.

## Estratégia geral

Ordem recomendada:

1. corrigir o contrato de conexão,
2. corrigir o backend de SSH e lifecycle,
3. introduzir abstração mínima por engine,
4. adaptar o frontend ao novo contrato,
5. migrar persistência e secrets,
6. validar fluxo ponta a ponta com Postgres e MySQL.

## Ordem exata de mudança

### Etapa 1: Tipos e contrato compartilhado

Objetivo:

- parar de modelar conexão como “Postgres com flags extras”,
- criar um contrato estável para o frontend e o backend.

Arquivos a alterar:

- `src/store/connections.ts`
- `src/features/connections/ConnectionForm.tsx`
- `src-tauri/src/db.rs`

Arquivos a criar:

- `src/features/connections/connection-engines.ts`

Checklist:

- criar `DatabaseEngine = 'postgres' | 'mysql'`
- criar `SshAuthMethod = 'password' | 'privateKey'`
- mover campos SSH soltos para um bloco `ssh`
- trocar `dbname` por `database`
- preparar campo `engine`
- manter compatibilidade de leitura com conexões antigas salvas

Decisão prática:

- nesta fase, não incluir `oracle` no type salvo no runtime real
- se quiser mostrar Oracle na UI, deixar desabilitado com badge “em breve”

## Etapa 2: Refactor do backend de conexão

Objetivo:

- remover hardcode estrutural de Postgres do fluxo de abertura,
- permitir escolher engine no backend sem duplicar tudo.

Arquivos a alterar:

- `src-tauri/src/db.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`

Arquivos a criar:

- `src-tauri/src/connection/types.rs`
- `src-tauri/src/connection/manager.rs`
- `src-tauri/src/engines/postgres.rs`
- `src-tauri/src/engines/mysql.rs`
- `src-tauri/src/engines/mod.rs`

Checklist:

- adicionar feature MySQL no `sqlx`
- criar enum/struct de config de conexão no backend
- criar `ConnectionHandle` por engine
- manter mapa de conexões abertas no state
- separar construção de URL por engine
- separar `test_connection` e `open_connection` por engine

Decisão prática:

- não tentar fazer trait excessivamente genérica nesta fase
- usar uma enum de handles e funções por engine

Exemplo de shape:

```rust
enum ConnectionHandle {
    Postgres(sqlx::PgPool),
    MySql(sqlx::MySqlPool),
}
```

## Etapa 3: Refactor do túnel SSH

Objetivo:

- substituir o túnel “thread solta + retorno otimista” por um handle controlado,
- suportar autenticação por senha e por chave privada.

Arquivos a alterar:

- `src-tauri/src/db.rs`

Arquivos a criar:

- `src-tauri/src/ssh/mod.rs`
- `src-tauri/src/ssh/tunnel.rs`

Checklist:

- criar `SshTunnelHandle`
- só devolver porta local após handshake e auth concluídos
- suportar `userauth_password`
- suportar `userauth_pubkey_file`
- suportar `passphrase`
- manter túnel associado à conexão aberta
- encerrar túnel ao fechar conexão
- expor comando `test_ssh_tunnel`

Regra importante:

- `test_connection` com SSH deve falhar explicitamente se o túnel não subir
- não pode mais retornar porta local antes da autenticação terminar

## Etapa 4: Persistência e segredos

Objetivo:

- deixar o store responsável só por metadados,
- evitar credenciais em texto puro no `localStorage`.

Arquivos a alterar:

- `src/store/connections.ts`
- `src/features/connections/ConnectionForm.tsx`

Arquivos prováveis a criar:

- `src/features/connections/connection-storage.ts`
- backend/commands para salvar e ler secret seguro

Checklist:

- definir quais campos continuam no `localStorage`
- remover senha do banco e senha SSH do payload persistido
- persistir secrets via backend
- usar `connectionId` como chave de lookup

Decisão prática:

- se você quiser reduzir risco e tempo de fase 1, dá para entregar em 2 subfases:
  - 1A: manter secrets no storage atual temporariamente
  - 1B: migrar para armazenamento seguro

Recomendação:

- ideal é não fechar a fase 1 sem pelo menos tirar `sshPassword` e `password` do `localStorage`

## Etapa 5: Refactor do formulário de conexão

Objetivo:

- fazer a UI refletir de forma clara engine + auth + SSH.

Arquivos a alterar:

- `src/features/connections/ConnectionForm.tsx`
- `src/features/connections/ConnectionManager.tsx`

Arquivos a criar:

- `src/features/connections/ConnectionSshSection.tsx`
- `src/features/connections/ConnectionDriverSection.tsx`

Checklist:

- adicionar seletor de engine
- trocar defaults conforme engine
- renomear `Database Name` para `Database`
- exibir sessão SSH separada
- adicionar seletor `Auth Method`
- se `password`, mostrar senha SSH
- se `privateKey`, mostrar path da chave e passphrase
- validar campos obrigatórios por modo
- mostrar se a conexão ativa é Postgres ou MySQL

Decisão prática:

- nesta fase, a seção Driver pode existir só como placeholder técnico
- se `engine === mysql` ou `postgres`, marcar driver como embutido

## Etapa 6: Query runner e explorer

Objetivo:

- manter o produto utilizável enquanto a arquitetura multi-engine entra.

Arquivos a alterar:

- `src/features/query/QueryWorkspace.tsx`
- `src/features/database/Explorer.tsx`
- backend de listagem/query

Checklist:

- `execute_query` funcionar para Postgres e MySQL
- explorer completo continuar para Postgres
- para MySQL, definir uma destas abordagens:
  - ocultar explorer nesta fase
  - ou exibir aviso “metadata explorer ainda não suportado para MySQL”

Recomendação:

- ocultar explorer de MySQL na fase 1 para reduzir acoplamento e retrabalho

## Etapa 7: Migração de conexões antigas

Objetivo:

- evitar quebrar conexões já cadastradas.

Arquivos a alterar:

- `src/store/connections.ts`

Checklist:

- detectar formato legado
- assumir `engine = postgres`
- converter `dbname -> database`
- converter `useSsh`, `sshHost`, `sshPort`, `sshUser`, `sshPassword` para `ssh`

## Etapa 8: Testes manuais e validação

Objetivo:

- garantir que a fase 1 fique realmente usável.

Checklist manual:

- cadastrar Postgres sem SSH
- testar conexão Postgres sem SSH
- abrir conexão Postgres sem SSH
- executar query Postgres
- explorar schemas/tabelas Postgres
- cadastrar Postgres com SSH por senha
- testar conexão Postgres com SSH por senha
- cadastrar Postgres com SSH por private key
- testar conexão Postgres com SSH por private key
- cadastrar MySQL sem SSH
- testar conexão MySQL sem SSH
- abrir conexão MySQL sem SSH
- executar query MySQL
- validar fechamento de conexão
- validar que segredos não ficam expostos no `localStorage`

## Checklist por arquivo

### Frontend

`src/store/connections.ts`

- redefinir `ConnectionConfig`
- adicionar migração de formato legado
- separar persistência de metadata

`src/features/connections/ConnectionForm.tsx`

- adicionar engine selector
- adaptar campos por engine
- mover SSH para bloco estruturado
- adicionar auth method
- validar private key path

`src/features/connections/ConnectionManager.tsx`

- exibir engine na lista
- adaptar open/test para novo payload
- esconder explorer quando engine não suportar

`src/features/database/Explorer.tsx`

- proteger render por engine/capability

`src/features/query/QueryWorkspace.tsx`

- manter execução independente de engine
- opcionalmente mostrar engine ativa na toolbar

### Backend

`src-tauri/Cargo.toml`

- adicionar feature MySQL do `sqlx`

`src-tauri/src/lib.rs`

- registrar comandos novos de SSH/driver se existirem

`src-tauri/src/db.rs`

- reduzir responsabilidade
- mover lógica de engine e ssh para módulos dedicados

`src-tauri/src/engines/postgres.rs`

- conexão
- test
- query
- metadata explorer

`src-tauri/src/engines/mysql.rs`

- conexão
- test
- query
- metadata básica se necessário

`src-tauri/src/ssh/tunnel.rs`

- handshake
- auth por password
- auth por private key
- lifecycle do túnel

## Sequência de implementação recomendada

Sequência técnica mais segura:

1. ajustar tipos do frontend e backend
2. adicionar suporte MySQL no Cargo e compilar
3. extrair builder de URL/params por engine
4. extrair módulo SSH com auth por private key
5. alterar `test_connection`
6. alterar `open_connection` e `close_connection`
7. adaptar `ConnectionForm`
8. adaptar `ConnectionManager`
9. esconder explorer em engines não suportadas
10. migrar persistência antiga
11. validar build frontend
12. validar `cargo check`
13. testar fluxos manuais

## Critério de pronto da fase 1

A fase 1 está pronta quando:

- o app continua funcionando para Postgres,
- MySQL já conecta e executa query,
- SSH com senha funciona,
- SSH com private key funciona,
- a UI permite escolher engine sem ambiguidade,
- não existe mais hardcode estrutural de Postgres no contrato de conexão,
- a base está preparada para introduzir Oracle depois sem reescrever tudo.

## Próxima fase após conclusão

Quando a fase 1 estiver fechada:

1. definir estratégia real de Oracle
2. implementar `DriverManager`
3. decidir UX de download/registro de driver
4. expandir metadata explorer por engine
