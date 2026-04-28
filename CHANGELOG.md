# Changelog

All notable changes to PulseSQL are documented here.

## [0.2.9] - 2026-04-28

### Added

- Salvar aba como .sql: botão direito na aba ou menu Arquivo → salva o script na pasta Downloads com o nome da aba

## [0.2.8] - 2026-04-28

### Added

- Abas: menu de contexto com botão direito — Nova Aba, Duplicar Aba, Fechar Aba, Fechar Todas as Outras

### Changed

- Botão de atualização disponível redesenhado como pill com indicador pulsante — mais visível no topo da janela
- Aba ativa destacada com a cor da conexão (fundo + bordas com transparência)

### Removed

- Legenda `⌘↵` removida do botão Run

## [0.2.7] - 2026-04-28

### Fixed

- Grid: clicar em uma célula limpa a seleção de linha e vice-versa
- Grid: executar a query novamente reseta imediatamente célula e linha selecionadas

## [0.2.6] - 2026-04-28

### Added

- Aba ativa destacada com a cor da conexão (fundo + bordas com transparência)
- Botão Run sem legenda `⌘↵`

### Changed

- ConnectionForm: layout fixo com header/footer pinados e corpo com scroll
- ConnectionForm: renderizado como dialog modal via portal — QueryWorkspace sempre visível
- ConnectionForm: cor da conexão aplicada em todo o formulário (bordas, SSH, badges, botões)
- ConnectionForm: seção SSH redesenhada com toggle ENABLED/DISABLED e card colorido
- ConnectionForm: timeout + reconexão em linha única; botão "Save as new" e metadata strip
- ConfigurationDialog: sidebar de navegação com ícones Lucide e cor da conexão ativa
- ConfigurationDialog: cor da conexão ativa no cabeçalho, nav, toggles e botão Salvar
- ConfigurationDialog: tabs Visual/JSON como segmented control com ícones
- ConfigurationDialog: aba Editor com Format on save (Cmd+S) e Auto-close brackets
- ConfigurationDialog: aviso de funcionalidades em preview no rodapé

## [0.2.5] - 2026-04-28

### Added

- Diagnósticos de performance por engine: `prepare_ms`, `count_ms`, `data_ms`, `serialize_ms`, `payload_bytes` visíveis no log técnico
- Grid: seleção de célula com clique simples; setas navegam; `Cmd/Ctrl+C` copia
- Grid: range selection com `Shift+click` e `Shift+seta`; `Cmd+A` seleciona tudo; copia como TSV
- Grid: renderização por tipo — números à direita, datas formatadas, boolean com chip, JSON em âmbar, null discreto
- Grid: painel de detalhe com valor completo, cópia e edição
- Grid: menu de coluna — ordenar, copiar nome, autoajustar largura, fixar, ocultar, filtro local
- Grid: colunas fixadas e ocultas persistidas em localStorage por layout
- Toolbar do resultado reorganizada em grupos visuais

### Changed

- `COUNT(*)` removido do caminho crítico: primeira página de SELECT/WITH responde com uma única operação SQL
- Contagem total agora ocorre em background (`count_query`) — UI atualiza quando disponível
- Oracle: conexão JDBC persistente por sessão — sem reconexão por query
- Oracle: chamadas ao sidecar rodam via `spawn_blocking` sem bloquear workers do Tauri

## [0.1.15] - 2026-04-22

### Added
- Native OS menu bar (File, Edit, View, Help) replacing the custom in-app menu bar
- Version number centered in the status bar — click to open release notes
- Release notes modal showing the full changelog
- Import/Export connections: backup and restore connections as JSON with per-connection selection
- Bottom-of-sidebar "New connection" button (hidden when no connections exist)
- Per-line copy button on connection log entries
- Empty-state CTA when no connections are saved

### Changed
- All connection log messages are now always in English regardless of app locale
- New Query Tab button style matches the New Connection button (dashed border hover)
- Explorer header icon updated to PanelLeft
- Sidebar minimum width increased to 300px to prevent header overflow

### Fixed
- Connection removal broken due to `window.confirm()` returning false in Tauri's WebView
- Export connections file download not working in WebView — now saves to Downloads folder via Rust command

## [0.1.14] - 2025-03-xx

### Added
- Grid sorting: click any column header to sort results ascending/descending
- Delete row confirmation dialog (replaces browser confirm dialog)
- Copy feedback on cell click with visual indicator
- Explorer error retry button when schema/table metadata fails to load
- Query error retry button in the query workspace
- Empty-state CTA button when no connections are saved
- Per-line copy button on connection logs and history entries
- Import/Export connections: backup and restore all connections as JSON
- Bottom-of-sidebar "New connection" button

### Fixed
- Connection removal broken due to `window.confirm()` returning `false` in Tauri's WebView
- All connection log messages now always output in English regardless of app locale

## [0.1.13] - 2025-02-xx

### Added
- Query history: view, search, and re-run past executions
- Delete individual history entries or clear all history
- Fullscreen result grid mode

## [0.1.12] - 2025-01-xx

### Added
- Autocommit toggle per connection in status bar
- COMMIT / ROLLBACK controls when a transaction is open
- Server time display in status bar

## [0.1.11] - 2024-12-xx

### Added
- SSH tunnel support for all database engines
- Oracle JDBC sidecar with automatic JDK detection and download
- Connection favorite: auto-open a designated connection on startup

## [0.1.10] - 2024-11-xx

### Added
- Inline cell editing in the result grid (double-click to edit)
- Primary key and foreign key badges on column headers
- Quick filter bar for result grid rows

## [0.1.9] - 2024-10-xx

### Added
- Result grid virtualization for large result sets
- Pagination controls with configurable page size
- Column resizing by dragging header separators
