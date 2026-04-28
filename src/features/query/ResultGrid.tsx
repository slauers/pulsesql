import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Check, Copy, PanelRightOpen, Pencil, X } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { writeText as clipboardWriteText } from '@tauri-apps/plugin-clipboard-manager';

interface ResultGridProps {
  columns: Array<{
    name: string;
    subtitle?: string | null;
    isPrimaryKey?: boolean;
    isForeignKey?: boolean;
    isAutoIncrement?: boolean;
  }>;
  rows: any[];
  rowNumberOffset?: number;
  density?: 'compact' | 'comfortable';
  onCellChange?: (colName: string, rowIndex: number, newValue: string | null, row: Record<string, unknown>) => void;
  pendingRowEdits?: Map<object, Record<string, string | null>>;
  pendingNewRows?: Record<string, unknown>[];
  focusNewRowToken?: number;
  selectedRowIndex?: number | null;
  onRowSelect?: (rowIndex: number, row: Record<string, unknown>) => void;
}

export default function ResultGrid({
  columns,
  rows,
  rowNumberOffset = 0,
  density = 'comfortable',
  onCellChange,
  pendingRowEdits,
  pendingNewRows,
  focusNewRowToken,
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
  const [selectedCell, setSelectedCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [detailCell, setDetailCell] = useState<{ rowIndex: number; column: string } | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const skipNextBlurRef = useRef(false);
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
  const allRows = [...sortedRows, ...(pendingNewRows ?? [])];

  const rowVirtualizer = useVirtualizer({
    count: allRows.length,
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

  // Safety net: if activeEditCell is set but the input never mounted, reset after 120ms
  useEffect(() => {
    if (!activeEditCell) return;
    const tid = window.setTimeout(() => {
      if (!editInputRef.current) setActiveEditCell(null);
    }, 120);
    return () => window.clearTimeout(tid);
  }, [activeEditCell]);

  useEffect(() => {
    if (!focusNewRowToken) return;
    const newRowIndex = allRows.length - 1;
    if (newRowIndex < 0) return;

    const firstEditableCol = columns.find((c) => !c.isAutoIncrement);
    if (!firstEditableCol) return;

    const cellKey = `${newRowIndex}-${firstEditableCol.name}`;

    // scrollToIndex is synchronous — virtualizer renders the row before the rAF fires
    rowVirtualizer.scrollToIndex(newRowIndex, { behavior: 'auto' });

    const raf = window.requestAnimationFrame(() => {
      setActiveEditCell(cellKey);
      setEditDraft('');
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNewRowToken]);

  const anyEditActive = activeEditCell !== null;

  const lockedRowIndex = (() => {
    if (!activeEditCell) return null;
    const idx = parseInt(activeEditCell, 10);
    return Number.isNaN(idx) ? null : idx;
  })();

  const handleCopyCell = (cellKey: string, value: unknown) => {
    const text = value === null ? '' : formatCellValue(value);
    void clipboardWriteText(text);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    setCopiedCell(cellKey);
    copyTimeoutRef.current = window.setTimeout(() => setCopiedCell(null), 1200);
  };

  const handleCellClick = (colName: string, rowIndex: number) => {
    if (anyEditActive && lockedRowIndex === rowIndex) return;
    if (activeEditCell) return;
    setSelectedCell({ rowIndex, column: colName });
    parentRef.current?.focus();
  };

  const openEdit = (cellKey: string, value: unknown) => {
    if (!onCellChange || anyEditActive) return;
    setActiveEditCell(cellKey);
    setEditDraft(value === null ? '' : formatCellValue(value));
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    setCopiedCell(null);
  };

  const commitEdit = (colName: string, rowIndex: number, row: Record<string, unknown>) => {
    if (!activeEditCell) return;
    setActiveEditCell(null);
    onCellChange?.(colName, rowIndex, editDraft === '' ? null : editDraft, row);
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

  useEffect(() => {
    if (!selectedCell) return;
    if (selectedCell.rowIndex >= allRows.length || !columns.some((column) => column.name === selectedCell.column)) {
      setSelectedCell(null);
    }
  }, [allRows.length, columns, selectedCell]);

  useEffect(() => {
    if (!detailCell) return;
    if (detailCell.rowIndex >= allRows.length || !columns.some((column) => column.name === detailCell.column)) {
      setDetailCell(null);
    }
  }, [allRows.length, columns, detailCell]);

  const detailContext = useMemo(() => {
    if (!detailCell) return null;

    const row = allRows[detailCell.rowIndex] as Record<string, unknown> | undefined;
    const column = columns.find((item) => item.name === detailCell.column);
    if (!row || !column) return null;

    const rowPendingEdits = detailCell.rowIndex >= sortedRows.length ? null : (pendingRowEdits?.get(row) ?? null);
    const hasStagedValue = column.name in (rowPendingEdits ?? {});
    const value = hasStagedValue ? rowPendingEdits?.[column.name] : row[column.name];
    const presentation = resolveCellPresentation(value, column.subtitle);

    return {
      row,
      column,
      value,
      presentation,
      cellKey: `${detailCell.rowIndex}-${column.name}`,
      rowNumber: rowNumberOffset + detailCell.rowIndex + 1,
    };
  }, [allRows, columns, detailCell, pendingRowEdits, rowNumberOffset, sortedRows.length]);

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && detailCell) {
      event.preventDefault();
      setDetailCell(null);
      return;
    }

    if (activeEditCell || !selectedCell) return;

    const isCopy = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c';
    if (isCopy) {
      const row = allRows[selectedCell.rowIndex] as Record<string, unknown> | undefined;
      if (!row) return;
      event.preventDefault();
      const cellKey = `${selectedCell.rowIndex}-${selectedCell.column}`;
      handleCopyCell(cellKey, row[selectedCell.column]);
      return;
    }

    const currentColumnIndex = columns.findIndex((column) => column.name === selectedCell.column);
    if (currentColumnIndex < 0) return;

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const nextColumnIndex = event.key === 'ArrowRight'
        ? Math.min(columns.length - 1, currentColumnIndex + 1)
        : event.key === 'ArrowLeft'
          ? Math.max(0, currentColumnIndex - 1)
          : currentColumnIndex;
      const nextRowIndex = event.key === 'ArrowDown'
        ? Math.min(allRows.length - 1, selectedCell.rowIndex + 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, selectedCell.rowIndex - 1)
          : selectedCell.rowIndex;

      setSelectedCell({ rowIndex: nextRowIndex, column: columns[nextColumnIndex].name });
      rowVirtualizer.scrollToIndex(nextRowIndex, { behavior: 'auto' });
      return;
    }

    if (event.key === 'Enter') {
      const row = allRows[selectedCell.rowIndex] as Record<string, unknown> | undefined;
      if (!row) return;
      event.preventDefault();
      openEdit(`${selectedCell.rowIndex}-${selectedCell.column}`, row[selectedCell.column]);
    }
  };

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      className="h-full w-full overflow-auto bg-transparent relative outline-none"
    >
      {!allRows.length ? (
        <div className="h-full flex items-center justify-center text-sm text-muted/60">
          Nenhum resultado para o filtro aplicado.
        </div>
      ) : null}
      <div
        className={`min-w-fit ${allRows.length ? '' : 'hidden'}`}
        style={{
          height: `${rowVirtualizer.getTotalSize() + headerHeight}px`,
          position: 'relative',
        }}
      >
        <div
          className="sticky top-0 z-10 flex border-b border-border/80 bg-surface/95 text-[11px] text-muted backdrop-blur"
          style={{ height: headerHeight }}
        >
          <div className="sticky left-0 w-12 shrink-0 select-none border-r border-border/35 bg-surface/95 px-2 py-2 text-center opacity-45">
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
                    activeResize?.column === col.name ? 'bg-primary/25' : 'hover:bg-primary/15'
                  }`}
                />
              </div>
            );
          })}
        </div>
        
        <div className="absolute w-full" style={{ top: `${headerHeight}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = allRows[virtualRow.index] as Record<string, unknown>;
            const isNewRow = virtualRow.index >= sortedRows.length;
            const rowPendingEdits = isNewRow ? null : (pendingRowEdits?.get(row) ?? null);
            const isDirtyRow = !isNewRow && rowPendingEdits != null;
            const rowTone = virtualRow.index % 2 === 0 ? 'bg-background/70' : 'bg-surface/26';
            const isThisRowLocked = lockedRowIndex === virtualRow.index;
            const isSelectedRow = selectedRowIndex === virtualRow.index;
            return (
              <div
                key={virtualRow.key}
                className={`group absolute flex w-full border-b text-sm transition-colors ${
                  isNewRow
                    ? 'border-emerald-400/20 bg-emerald-400/6'
                    : isDirtyRow
                      ? 'border-amber-400/20 bg-amber-400/6'
                      : `border-border/20 ${rowTone}`
                } ${
                  isSelectedRow
                    ? 'ring-1 ring-inset ring-primary/20 bg-primary/5'
                    : isThisRowLocked
                      ? 'ring-1 ring-inset ring-primary/20'
                      : 'hover:bg-surface/55'
                }`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <button
                  type="button"
                  onClick={() => onRowSelect?.(virtualRow.index, row)}
                  className={`sticky left-0 flex w-12 shrink-0 items-center justify-center border-r px-2 text-xs font-mono transition-colors ${
                    isNewRow
                      ? 'border-emerald-400/20 bg-emerald-400/6 text-emerald-300/60'
                      : isDirtyRow
                        ? 'border-amber-400/20 bg-amber-400/6 text-amber-300/60'
                        : isSelectedRow
                          ? `bg-primary/5 text-text border-border/25`
                          : `${rowTone} text-muted/45 border-border/25 ${isThisRowLocked ? '' : 'group-hover:bg-surface/55'}`
                  }`}
                  title="Selecionar linha"
                >
                  {isNewRow ? '+' : rowNumberOffset + virtualRow.index + 1}
                </button>
                {columns.map((col, cIdx) => {
                  const stagedValue = rowPendingEdits?.[col.name];
                  const hasStagedValue = col.name in (rowPendingEdits ?? {});
                  const val = hasStagedValue ? stagedValue : row[col.name];
                  const presentation = resolveCellPresentation(val, col.subtitle);
                  const cellKey = `${virtualRow.index}-${col.name}`;
                  const isCopied = copiedCell === cellKey;
                  const isEditing = activeEditCell === cellKey;
                  const isSelectedCell = selectedCell?.rowIndex === virtualRow.index && selectedCell.column === col.name;
                  const isInactiveCell = isThisRowLocked && !isEditing;
                  const canOpenDetail = shouldOfferDetail(presentation);
                  return (
                    <div
                      key={cIdx}
                      onClick={() => {
                        if (isNewRow && !isEditing) {
                          openEdit(cellKey, val);
                          return;
                        }
                        handleCellClick(col.name, virtualRow.index);
                      }}
                      onDoubleClick={() => {
                        if (!isNewRow) openEdit(cellKey, val);
                      }}
                      className={`flex items-center gap-1.5 overflow-hidden whitespace-nowrap border-r border-border/20 px-3.5 font-mono text-[13px] transition-colors ${presentation.alignClass} ${
                        isEditing
                          ? 'bg-primary/10 outline outline-1 outline-primary/60 p-0'
                          : hasStagedValue
                            ? 'bg-amber-400/10 text-amber-100'
                            : isInactiveCell
                              ? 'pointer-events-none select-none text-text opacity-35'
                              : isCopied
                                ? 'bg-emerald-400/16 text-emerald-100'
                                : isSelectedCell
                                  ? 'cursor-pointer text-ellipsis bg-primary/10 text-text ring-1 ring-inset ring-primary/45'
                                  : 'cursor-pointer text-ellipsis text-text/94'
                      }`}
                      style={{ width: `${resolvedWidths[col.name]}px`, minWidth: `${resolvedWidths[col.name]}px` }}
                      title={presentation.rawValue}
                    >
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitEdit(col.name, virtualRow.index, row);
                            } else if (e.key === 'Tab') {
                              e.preventDefault();
                              const newValue = editDraft === '' ? null : editDraft;
                              onCellChange?.(col.name, virtualRow.index, newValue, row);
                              skipNextBlurRef.current = true;

                              const editableCols = isNewRow
                                ? columns.filter((c) => !c.isAutoIncrement)
                                : columns;
                              const editableIdx = editableCols.findIndex((c) => c.name === col.name);
                              const nextIdx = editableIdx + (e.shiftKey ? -1 : 1);

                              if (nextIdx >= 0 && nextIdx < editableCols.length) {
                                const nextCol = editableCols[nextIdx];
                                const stagedEdits = pendingRowEdits?.get(row) ?? {};
                                const nextRaw = nextCol.name in stagedEdits
                                  ? stagedEdits[nextCol.name]
                                  : row[nextCol.name];
                                setActiveEditCell(`${virtualRow.index}-${nextCol.name}`);
                                setEditDraft(nextRaw === null ? '' : formatCellValue(nextRaw as unknown));
                              } else {
                                setActiveEditCell(null);
                              }
                            } else if (e.key === 'Escape') {
                              cancelEdit();
                            }
                          }}
                          onBlur={() => {
                            if (skipNextBlurRef.current) {
                              skipNextBlurRef.current = false;
                              return;
                            }
                            commitEdit(col.name, virtualRow.index, row);
                          }}
                          className="w-full h-full px-3 bg-transparent text-text font-mono text-sm outline-none"
                        />
                      ) : isCopied ? (
                        <>
                          <Check size={11} className="shrink-0 text-emerald-400" />
                          <span className={`min-w-0 overflow-hidden text-ellipsis ${presentation.valueClass}`}>
                            {renderPresentedValue(presentation)}
                          </span>
                        </>
                      ) : (
                        renderPresentedValue(presentation)
                      )}
                      {!isEditing && canOpenDetail ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedCell({ rowIndex: virtualRow.index, column: col.name });
                            setDetailCell({ rowIndex: virtualRow.index, column: col.name });
                          }}
                          className={`ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border/60 bg-background/40 text-muted transition-colors hover:border-primary/45 hover:text-text ${
                            isSelectedCell ? 'opacity-100' : 'opacity-55 hover:opacity-100'
                          }`}
                          title="Abrir detalhe"
                        >
                          <PanelRightOpen size={12} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {detailContext ? (
        <div className="absolute bottom-3 right-3 z-20 flex max-h-[min(70%,420px)] w-[min(520px,calc(100%-24px))] flex-col overflow-hidden rounded-lg border border-border bg-surface text-xs text-text shadow-2xl">
          <div className="flex items-start gap-3 border-b border-border/70 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-mono text-[12px] font-semibold text-text">
                  {detailContext.column.name}
                </span>
                {detailContext.column.isPrimaryKey ? (
                  <span className="shrink-0 rounded border border-amber-400/30 bg-amber-400/18 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-300">
                    PK
                  </span>
                ) : null}
                {detailContext.column.isForeignKey ? (
                  <span className="shrink-0 rounded border border-sky-400/30 bg-sky-400/18 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-sky-300">
                    FK
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted">
                Linha {detailContext.rowNumber}
                {detailContext.column.subtitle ? ` · ${detailContext.column.subtitle}` : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => handleCopyCell(detailContext.cellKey, detailContext.value)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted transition-colors hover:bg-border/30 hover:text-text"
                title="Copiar valor"
              >
                <Copy size={13} />
              </button>
              {onCellChange && !detailContext.column.isAutoIncrement ? (
                <button
                  type="button"
                  onClick={() => {
                    setDetailCell(null);
                    openEdit(detailContext.cellKey, detailContext.value);
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted transition-colors hover:bg-border/30 hover:text-text"
                  title="Editar valor"
                >
                  <Pencil size={13} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDetailCell(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 text-muted transition-colors hover:bg-border/30 hover:text-text"
                title="Fechar"
              >
                <X size={13} />
              </button>
            </div>
          </div>
          <pre className="min-h-[120px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[12px] leading-5 text-text/95">
            {formatDetailValue(detailContext.value)}
          </pre>
        </div>
      ) : null}
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

function formatDetailValue(value: unknown) {
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return formatCellValue(value);
    }
  }

  return formatCellValue(value);
}

type CellKind = 'null' | 'number' | 'date' | 'boolean' | 'json' | 'text';

function resolveCellPresentation(value: unknown, subtitle?: string | null) {
  const rawValue = formatCellValue(value);
  const typeHint = (subtitle ?? '').toLowerCase();
  const kind = inferCellKind(value, typeHint);
  const displayValue = kind === 'date' ? formatDatePreview(value, rawValue) : rawValue;

  return {
    kind,
    rawValue,
    displayValue,
    alignClass: kind === 'number' ? 'justify-end text-right tabular-nums' : '',
    valueClass: [
      kind === 'null' ? 'text-muted/50 italic' : '',
      kind === 'number' ? 'tabular-nums text-cyan-100/95' : '',
      kind === 'date' ? 'tabular-nums text-violet-100/95' : '',
      kind === 'json' ? 'text-amber-100/95' : '',
    ].filter(Boolean).join(' '),
  };
}

function inferCellKind(value: unknown, typeHint: string): CellKind {
  if (value === null || typeof value === 'undefined') {
    return 'null';
  }

  if (typeof value === 'boolean' || /\b(bool|boolean)\b/.test(typeHint)) {
    return 'boolean';
  }

  if (Array.isArray(value) || (typeof value === 'object' && value !== null) || /\b(json|jsonb|xml)\b/.test(typeHint)) {
    return 'json';
  }

  if (/\b(date|time|timestamp|timestamptz)\b/.test(typeHint)) {
    return 'date';
  }

  if (
    typeof value === 'number'
    || typeof value === 'bigint'
    || /\b(number|numeric|decimal|integer|int|bigint|smallint|float|double|real|serial|money)\b/.test(typeHint)
  ) {
    return 'number';
  }

  return 'text';
}

function formatDatePreview(value: unknown, fallback: string) {
  const raw = value instanceof Date ? value.toISOString() : fallback;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = value instanceof Date ? value : new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  const hasTime = /[ t]\d{1,2}:\d{2}/i.test(raw);
  return hasTime
    ? date.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    : date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
}

function renderPresentedValue(presentation: ReturnType<typeof resolveCellPresentation>) {
  if (presentation.kind === 'boolean') {
    const isTrue = presentation.rawValue.toLowerCase() === 'true' || presentation.rawValue === '1';
    return (
      <span className={`inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold uppercase tracking-wide ${
        isTrue
          ? 'border-emerald-400/30 bg-emerald-400/12 text-emerald-200'
          : 'border-border/70 bg-background/35 text-muted'
      }`}>
        {presentation.rawValue}
      </span>
    );
  }

  return (
    <span className={`min-w-0 overflow-hidden text-ellipsis ${presentation.valueClass}`}>
      {presentation.displayValue}
    </span>
  );
}

function shouldOfferDetail(presentation: ReturnType<typeof resolveCellPresentation>) {
  return presentation.kind === 'json' || presentation.rawValue.length > 80 || presentation.rawValue.includes('\n');
}
