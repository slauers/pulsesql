# Changelog

All notable changes to PulseSQL are documented here.

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
- Delete row confirmation dialog
- Copy feedback on cell click with visual indicator
- Explorer error retry button when schema/table metadata fails to load
- Query error retry button in the query workspace

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
