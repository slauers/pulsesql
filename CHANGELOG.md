# Changelog

All notable changes to PulseSQL are documented here.

## [0.1.15] - Unreleased

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
