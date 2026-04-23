import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Check, LoaderCircle } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface ResultGridProps {
  columns: Array<{
    name: string;
    subtitle?: string | null;
    isPrimaryKey?: boolean;
    isForeignKey?: boolean;
  }>;
  rows: any[];
  rowNumberOffset?: number;
  density?: 'compact' | 'comfortable';
  onCellEdit?: (colName: string, rowIndex: number, newValue: string | null, row: Record<string, unknown>) => Promise<void>;
  editingCell?: string | null;
  editError?: string | null;
  selectedRowIndex?: number | null;
  onRowSelect?: (rowIndex: number, row: Record<string, unknown>) => void;
}

export default function ResultGrid({
  columns,
  rows,
  rowNumberOffset = 0,
  density = 'comfortable',
  onCellEdit,
  editingCell,
  editError,
  selectedRowIndex = null,
  onRowSelect,
}: ResultGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [activeResize, setActiveResize] = useState<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [sortConfig, setSortConfig] = useState<{ column: string; dir: 'asc' | 'desc' } | null>(null);
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const [activeEditCell, setActiveEditCell] = useState<string | null>(null);
  const [pendingEditCell, setPendingEditCell] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const resolvedWidths = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [
          column.name,
          Math.max(columnWidths[column.name] ?? estimateColumnWidth(column, rows), 120),
        ]),
      ),
    [columnWidths, columns, rows],
  );

  const sortedRows = useMemo(() => {
    if (!sortConfig) return rows;
    const { column, dir } = sortConfig;
    return [...rows].sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (av === null || av === undefined) return dir === 'asc' ? 1 : -1;
      if (bv === null || bv === undefined) return dir === 'asc' ? -1 : 1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortConfig]);

  const handleSortToggle = (colName: string) => {
    setSortConfig((current) => {
      if (current?.column === colName) {
        return current.dir === 'asc' ? { column: colName, dir: 'desc' } : null;
      }
      return { column: colName, dir: 'asc' };
    });
  };

  const rowHeight = density === 'compact' ? 26 : 30;
  const headerHeight = density === 'compact' ? 40 : 44;

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 20,
  });

  useEffect(() => {
    if (!activeResize) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const delta = event.clientX - activeResize.startX;
      setColumnWidths((current) => ({
        ...current,
        [activeResize.column]: Math.max(activeResize.startWidth + delta, 120),
      }));
    };

    const handlePointerUp = () => {
      setActiveResize(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [activeResize]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
  }, []);

  const anyEditActive = activeEditCell !== null || editingCell !== null || pendingEditCell !== null;

  const lockedRowIndex = (() => {
    const key = activeEditCell ?? editingCell ?? pendingEditCell;
    if (!key) return null;
    const idx = parseInt(key, 10);
    return Number.isNaN(idx) ? null : idx;
  })();

  const handleCellClick = (cellKey: string, value: unknown, rowIndex: number) => {
    if (anyEditActive && lockedRowIndex === rowIndex) return;
    if (activeEditCell) return;
    const text = value === null ? '' : formatCellValue(value);
    navigator.clipboard.writeText(text).catch(() => null);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    setCopiedCell(cellKey);
    copyTimeoutRef.current = window.setTimeout(() => setCopiedCell(null), 1200);
  };

  const openEdit = (cellKey: string, value: unknown) => {
    if (!onCellEdit || anyEditActive) return;
    setActiveEditCell(cellKey);
    setEditDraft(value === null ? '' : formatCellValue(value));
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    setCopiedCell(null);
  };

  const commitEdit = async (colName: string, rowIndex: number, row: Record<string, unknown>) => {
    if (!onCellEdit || !activeEditCell) return;
    const cellKey = activeEditCell;
    setPendingEditCell(cellKey);
    setActiveEditCell(null);
    try {
      await onCellEdit(colName, rowIndex, editDraft === '' ? null : editDraft, row);
    } finally {
      setPendingEditCell((current) => (current === cellKey ? null : current));
    }
  };

  const cancelEdit = () => {
    setActiveEditCell(null);
  };

  useEffect(() => {
    if (activeEditCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [activeEditCell]);

  return (
    <div ref={parentRef} className="h-full w-full overflow-auto bg-transparent relative">
      {!sortedRows.length ? (
        <div className="h-full flex items-center justify-center text-sm text-muted/60">
          Nenhum resultado para o filtro aplicado.
        </div>
      ) : null}
      <div
        className={`min-w-fit ${sortedRows.length ? '' : 'hidden'}`}
        style={{
          height: `${rowVirtualizer.getTotalSize() + headerHeight}px`,
          position: 'relative',
        }}
      >
        <div
          className="sticky top-0 z-10 flex border-b border-border/80 bg-[#0c1621]/95 text-[11px] text-muted shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur"
          style={{ height: headerHeight }}
        >
          <div className="sticky left-0 w-12 shrink-0 select-none border-r border-border/35 bg-[#0c1621]/95 px-2 py-2 text-center opacity-45">
            #
          </div>
          {columns.map((col, idx) => {
            const isSorted = sortConfig?.column === col.name;
            return (
              <div
                key={idx}
                className="relative border-r border-border/35"
                style={{ width: `${resolvedWidths[col.name]}px`, minWidth: `${resolvedWidths[col.name]}px` }}
              >
                <div
                  className="cursor-pointer select-none overflow-hidden whitespace-nowrap px-3 py-1.5 leading-tight text-ellipsis hover:bg-background/28"
                  onClick={() => handleSortToggle(col.name)}
                  title={`Ordenar por ${col.name}`}
                >
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className={`overflow-hidden text-ellipsis font-mono text-[12px] normal-case tracking-normal ${isSorted ? 'text-primary' : 'text-text/92'}`}>
                      {col.name}
                    </span>
                    {isSorted ? (
                      sortConfig.dir === 'asc'
                        ? <ArrowUp size={11} className="shrink-0 text-primary" />
                        : <ArrowDown size={11} className="shrink-0 text-primary" />
                    ) : null}
                    {col.isPrimaryKey ? (
                      <span className="shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-amber-400/18 text-amber-300 border border-amber-400/30">
                        PK
                      </span>
                    ) : null}
                    {col.isForeignKey ? (
                      <span className="shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-sky-400/18 text-sky-300 border border-sky-400/30">
                        FK
                      </span>
                    ) : null}
                  </div>
                  {col.subtitle ? (
                    <div className="overflow-hidden text-ellipsis text-[10px] font-normal normal-case tracking-normal text-muted/60">
                      {col.subtitle}
                    </div>
                  ) : null}
                </div>
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${col.name} column`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setActiveResize({
                      column: col.name,
                      startX: event.clientX,
                      startWidth: resolvedWidths[col.name],
                    });
                  }}
                  className={`absolute right-0 top-0 h-full w-1 cursor-col-resize transition-colors ${
                    activeResize?.column === col.name ? 'bg-primary/40' : 'hover:bg-primary/25'
                  }`}
                />
              </div>
            );
          })}
        </div>
        
        <div className="absolute w-full" style={{ top: `${headerHeight}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = sortedRows[virtualRow.index];
            const rowTone = virtualRow.index % 2 === 0 ? 'bg-[#09131d]' : 'bg-[#0b1520]';
            const isThisRowLocked = lockedRowIndex === virtualRow.index;
            const isSelectedRow = selectedRowIndex === virtualRow.index;
            return (
              <div
                key={virtualRow.key}
                className={`group absolute flex w-full border-b border-border/20 text-sm transition-colors ${rowTone} ${
                  isSelectedRow
                    ? 'ring-1 ring-inset ring-primary/35 bg-primary/6'
                    : isThisRowLocked
                      ? 'ring-1 ring-inset ring-primary/25'
                      : 'hover:bg-[#0e1a27]'
                }`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <button
                  type="button"
                  onClick={() => onRowSelect?.(virtualRow.index, row as Record<string, unknown>)}
                  className={`sticky left-0 flex w-12 shrink-0 items-center justify-center border-r border-border/25 px-2 text-xs font-mono transition-colors ${
                    isSelectedRow
                      ? 'bg-primary/8 text-primary'
                      : `${rowTone} text-muted/45 ${isThisRowLocked ? '' : 'group-hover:bg-[#0e1a27]'}`
                  }`}
                  title="Selecionar linha"
                >
                  {rowNumberOffset + virtualRow.index + 1}
                </button>
                {columns.map((col, cIdx) => {
                  const val = row[col.name];
                  const displayValue = formatCellValue(val);
                  const cellKey = `${virtualRow.index}-${col.name}`;
                  const isCopied = copiedCell === cellKey;
                  const isEditing = activeEditCell === cellKey;
                  const isPendingEdit = editingCell === cellKey || pendingEditCell === cellKey;
                  const hasEditError = editError != null && editingCell === cellKey;
                  const isInactiveCell = isThisRowLocked && !isEditing && !isPendingEdit && !hasEditError;
                  return (
                    <div
                      key={cIdx}
                      onClick={() => handleCellClick(cellKey, val, virtualRow.index)}
                      onDoubleClick={() => openEdit(cellKey, val)}
                      className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap border-r border-border/20 px-3.5 font-mono text-[13px] transition-colors ${
                        isEditing
                          ? 'bg-primary/10 outline outline-1 outline-primary/60 p-0'
                          : isPendingEdit
                            ? 'bg-sky-400/10 text-sky-100'
                            : hasEditError
                              ? 'bg-red-400/12 text-red-100'
                              : isInactiveCell
                                ? 'pointer-events-none select-none text-text opacity-35'
                                : isCopied
                                  ? 'bg-emerald-400/16 text-emerald-100'
                                  : 'cursor-pointer text-ellipsis text-text/94'
                      }`}
                      style={{ width: `${resolvedWidths[col.name]}px`, minWidth: `${resolvedWidths[col.name]}px` }}
                      title={hasEditError ? editError : displayValue}
                    >
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitEdit(col.name, virtualRow.index, row as Record<string, unknown>);
                            } else if (e.key === 'Escape') {
                              cancelEdit();
                            }
                          }}
                          onBlur={() => void commitEdit(col.name, virtualRow.index, row as Record<string, unknown>)}
                          className="w-full h-full px-3 bg-transparent text-text font-mono text-sm outline-none"
                        />
                      ) : isPendingEdit ? (
                        <>
                          <LoaderCircle size={11} className="shrink-0 text-sky-400 animate-spin" />
                          <span className="overflow-hidden text-ellipsis opacity-50">{val === null ? <span className="italic">null</span> : displayValue}</span>
                        </>
                      ) : isCopied ? (
                        <>
                          <Check size={11} className="shrink-0 text-emerald-400" />
                          <span className="overflow-hidden text-ellipsis">{val === null ? <span className="italic">null</span> : displayValue}</span>
                        </>
                      ) : (
                        val === null ? <span className="text-muted/50 italic">null</span> : displayValue
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function estimateColumnWidth(
  column: {
    name: string;
    subtitle?: string | null;
  },
  rows: any[],
) {
  const headerText = [column.name, column.subtitle].filter(Boolean).join(' ');
  const headerWidth = Math.max(headerText.length * 8 + 36, 140);
  const sampleWidth = rows.slice(0, 20).reduce((max, row) => {
    const cellLength = formatCellValue(row?.[column.name]).length;
    return Math.max(max, Math.min(cellLength * 8 + 28, 420));
  }, 0);

  return Math.max(headerWidth, sampleWidth, 140);
}

function formatCellValue(value: unknown) {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  if (typeof value === 'undefined') {
    return 'undefined';
  }

  return String(value);
}
