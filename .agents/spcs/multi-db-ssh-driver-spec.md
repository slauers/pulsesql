# Spec: Multi-DB + SSH + Driver Manager

## Objetivo

Evoluir o `smalldbclient` para suportar:

- configuração de conexão por tipo de banco (`Postgres`, `MySQL`, `Oracle`, depois `SQL Server` se fizer sentido),
- túnel SSH completo com autenticação por senha e por chave privada,
- seleção de banco/driver no momento da criação da conexão,
- estratégia de provisionamento de driver quando necessário,
- base preparada para crescer sem acoplar toda a aplicação a Postgres.

A primeira entrega deve ser pragmática:

- fase 1: `Postgres` + `MySQL` com túnel SSH robusto
- fase 2: `Oracle` com estratégia de driver dedicada
- fase 3: outros bancos se necessário

## Contexto

Hoje o projeto já funciona como desktop app leve com Tauri + React, mas a camada de conexão está acoplada a Postgres e o SSH só cobre o caso simples por usuário/senha.

Onde isso está no código atual:

- Form de conexão: `src/features/connections/ConnectionForm.tsx`
- Store de conexões: `src/store/connections.ts`
- Backend de conexão/query: `src-tauri/src/db.rs`
- Dependências Rust: `src-tauri/Cargo.toml`

Limitações atuais:

- `ConnectionConfig` só representa Postgres
- URL de conexão é sempre `postgres://`
- metadata explorer usa queries específicas de Postgres
- SSH não suporta private key/passphrase
- não existe gestão de drivers
- secrets ficam em `localStorage`

## Regra de negócio

1. O usuário pode criar uma conexão escolhendo o tipo de banco.
2. Cada tipo de banco define:
- porta padrão
- campos obrigatórios
- estratégia de conexão
- capacidade de explorar metadata
- necessidade ou não de driver externo

3. O usuário pode habilitar SSH opcionalmente.
4. O SSH deve suportar no mínimo:
- autenticação por senha
- autenticação por chave privada
- passphrase opcional
- host, porta e usuário do bastion
- teste de túnel antes de abrir a conexão final

5. Ao testar conexão:
- se houver SSH, o túnel deve ser validado primeiro
- depois a conexão com o banco deve ser validada
- a UI deve mostrar erro específico de SSH ou de banco

6. Ao abrir conexão:
- o app deve manter o recurso de conexão e o túnel vivos enquanto a conexão estiver ativa
- ao fechar conexão, deve encerrar pool/sessão/túnel associado

7. Driver:
- para bancos suportados nativamente pelo binário, não há download
- para bancos que dependam de artefato externo, o app deve checar presença do driver, permitir download/registro e só então conectar

## Dados e integrações

Novo contrato sugerido para conexão:

```ts
type DatabaseEngine = 'postgres' | 'mysql' | 'oracle';

type SshAuthMethod = 'password' | 'privateKey';

interface SshConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  user?: string;
  authMethod?: SshAuthMethod;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  localHost?: string;
  localPort?: number;
}

interface DriverConfig {
  kind: 'bundled' | 'managed';
  driverId?: string;
  version?: string;
  installed?: boolean;
  path?: string;
}

interface ConnectionConfig {
  id: string;
  name: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  database?: string;
  serviceName?: string;
  sid?: string;
  user: string;
  password?: string;
  ssl?: boolean;
  ssh?: SshConfig;
  driver?: DriverConfig;
}
```

Regras por engine:

- `postgres`
  - usa `database`
  - porta default `5432`
  - driver nativo no backend
- `mysql`
  - usa `database`
  - porta default `3306`
  - driver nativo no backend
- `oracle`
  - usa `serviceName` ou `sid`
  - porta default `1521`
  - pode exigir estratégia especial de driver

Integrações/backend necessárias:

- `connection test`
- `open connection`
- `close connection`
- `list databases` por engine quando suportado
- `list schemas/tables/columns` por engine
- `execute query` por engine
- `driver registry/install status`
- `ssh tunnel test`

Persistência:

- metadados da conexão podem continuar localmente
- segredos devem sair de `localStorage` e ir para keychain do sistema ou armazenamento seguro equivalente

## Permissões

Não há sistema de roles/tenant no projeto hoje.

Pontos de segurança obrigatórios:

- não persistir senha do banco e senha SSH em `localStorage`
- não persistir conteúdo de private key em texto puro se não for indispensável
- preferir persistir caminho do arquivo de chave
- validar leitura do arquivo de chave no backend, nunca no frontend
- separar erro de autenticação SSH, erro de handshake e erro de banco
- idealmente validar host key do servidor SSH ou ao menos prever esse fluxo na arquitetura

## Critérios de aceite

1. O form de conexão permite escolher `Postgres`, `MySQL` ou `Oracle`.
2. Ao trocar engine, o formulário adapta:
- labels
- porta padrão
- campos obrigatórios
- placeholders

3. O form de SSH permite escolher:
- sem SSH
- SSH com senha
- SSH com private key

4. Para `private key`, o usuário informa:
- usuário SSH
- host
- porta
- caminho da chave privada
- passphrase opcional

5. O comando “testar conexão” retorna erros distintos:
- falha no SSH
- falha no banco
- falha de driver ausente
- timeout

6. O backend mantém o túnel ativo durante a conexão aberta.
7. O fechamento da conexão encerra corretamente recursos associados.
8. `Postgres` continua funcionando com query runner e explorer.
9. `MySQL` passa a funcionar com query runner.
10. `Oracle` só aparece habilitado se houver estratégia de driver definida.
11. Se o driver for necessário e estiver ausente, a UI informa e oferece ação de baixar/registrar.
12. Secrets deixam de ficar expostos em `localStorage`.

## Impacto técnico

Frontend:

- refatorar o form para modelagem orientada por `engine`
- separar bloco “Database”, bloco “Authentication”, bloco “SSH”, bloco “Driver”
- exibir capability por engine
- adicionar estados de instalação/status de driver

Core/store:

- mudar `ConnectionConfig`
- criar migração de conexões salvas antigas
- separar metadado persistido de segredo seguro

Backend:

- introduzir abstração por engine
- desacoplar `PgPool` do estado global
- criar `ConnectionHandle` por engine
- criar `SshTunnelHandle` com lifecycle explícito
- implementar autenticação SSH por senha e por chave privada
- adicionar comandos Tauri para driver manager

Arquitetura sugerida no Rust:

- `connection/mod.rs`
- `connection/types.rs`
- `connection/manager.rs`
- `ssh/mod.rs`
- `ssh/tunnel.rs`
- `drivers/mod.rs`
- `engines/postgres.rs`
- `engines/mysql.rs`
- `engines/oracle.rs`

Estratégia de drivers recomendada:

- `Postgres` e `MySQL`: suporte nativo embutido no backend
- `Oracle`: tratar como engine especial
  - opção A: integração com biblioteca/driver externo registrado localmente
  - opção B: sidecar/adapter dedicado
  - opção C: desabilitar na fase 1 e deixar preparado no contrato/UI

Decisão técnica recomendada:

- não tentar implementar “download dinâmico universal de driver” na fase 1
- primeiro criar um `DriverManager` com interface e suporte real só ao caso necessário
- Oracle deve entrar só quando a estratégia concreta de driver estiver definida

## Arquivos prováveis

Frontend:

- `src/features/connections/ConnectionForm.tsx`
- `src/features/connections/ConnectionManager.tsx`
- `src/store/connections.ts`

Prováveis novos arquivos frontend:

- `src/features/connections/connection-engines.ts`
- `src/features/connections/ConnectionDriverSection.tsx`
- `src/features/connections/ConnectionSshSection.tsx`

Backend:

- `src-tauri/src/db.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`

Prováveis novos arquivos backend:

- `src-tauri/src/connection/mod.rs`
- `src-tauri/src/connection/types.rs`
- `src-tauri/src/connection/manager.rs`
- `src-tauri/src/ssh/mod.rs`
- `src-tauri/src/ssh/tunnel.rs`
- `src-tauri/src/drivers/mod.rs`
- `src-tauri/src/engines/postgres.rs`
- `src-tauri/src/engines/mysql.rs`
- `src-tauri/src/engines/oracle.rs`

## Riscos

1. Oracle não encaixa naturalmente no modelo atual com `sqlx`; se entrar, vai exigir estratégia diferente de Postgres/MySQL.
2. Download e registro de driver trazem custo de UX, versionamento e suporte multiplataforma.
3. SSH com private key precisa lifecycle correto; implementação parcial vira fonte de bug intermitente.
4. Metadata explorer multi-engine aumenta bastante a complexidade porque catálogo muda por banco.
5. Migrar conexões já salvas exige compatibilidade com o formato antigo.
6. Persistência segura de secrets pode exigir plugin/dependência nova no Tauri.

## Fases recomendadas

1. Fase 1
- refatorar `ConnectionConfig`
- implementar `engine = postgres | mysql`
- refatorar SSH para `password | privateKey`
- mover secrets para armazenamento seguro
- manter explorer completo em Postgres
- query runner em Postgres/MySQL

2. Fase 2
- criar `DriverManager`
- preparar UI de status de driver
- definir estratégia real de Oracle
- habilitar Oracle só após essa definição

3. Fase 3
- expandir explorer/metadata por engine
- adicionar SQL Server ou outros bancos se houver demanda real
