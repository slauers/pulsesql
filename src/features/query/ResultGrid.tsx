import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface ResultGridProps {
  columns: Array<{
    name: string;
    subtitle?: string | null;
  }>;
  rows: any[];
  rowNumberOffset?: number;
  density?: 'compact' | 'comfortable';
}

export default function ResultGrid({ columns, rows, rowNumberOffset = 0, density = 'comfortable' }: ResultGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [activeResize, setActiveResize] = useState<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);

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

  const rowHeight = density === 'compact' ? 26 : 30;
  const headerHeight = density === 'compact' ? 40 : 44;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
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

  return (
    <div ref={parentRef} className="h-full w-full overflow-auto bg-transparent relative">
      {!rows.length ? (
        <div className="h-full flex items-center justify-center text-sm text-muted/60">
          Nenhum resultado para o filtro aplicado.
        </div>
      ) : null}
      <div
        className={`min-w-fit ${rows.length ? '' : 'hidden'}`}
        style={{
          height: `${rowVirtualizer.getTotalSize() + headerHeight}px`,
          position: 'relative',
        }}
      >
        <div className="flex bg-surface/95 backdrop-blur text-xs text-muted sticky top-0 z-10 border-b border-border/90 shadow-[0_8px_24px_rgba(0,0,0,0.18)]" style={{ height: headerHeight }}>
          <div className="w-14 px-2 py-2 text-center sticky left-0 bg-surface/95 select-none opacity-50 shrink-0 border-r border-border/50">
            #
          </div>
          {columns.map((col, idx) => (
            <div
              key={idx}
              className="relative border-r border-border/50"
              style={{ width: `${resolvedWidths[col.name]}px`, minWidth: `${resolvedWidths[col.name]}px` }}
            >
              <div className="px-3 py-1.5 leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
                <div className="overflow-hidden text-ellipsis text-sm font-medium normal-case tracking-normal text-text">
                  {col.name}
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
          ))}
        </div>
        
        <div className="absolute w-full divide-y divide-border/30" style={{ top: `${headerHeight}px` }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const rowTone = virtualRow.index % 2 === 0 ? 'bg-[#0A1321]' : 'bg-[#0D1726]';
            return (
              <div
                key={virtualRow.key}
                className={`group absolute w-full flex text-sm transition-colors ${rowTone} hover:bg-primary/10`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div className={`w-14 px-2 flex items-center justify-center border-r border-border/20 text-xs text-muted/50 font-mono sticky left-0 shrink-0 ${rowTone} group-hover:bg-primary/10`}>
                  {rowNumberOffset + virtualRow.index + 1}
                </div>
                {columns.map((col, cIdx) => {
                  const val = row[col.name];
                  return (
                    <div 
                      key={cIdx} 
                      className="px-3 flex items-center whitespace-nowrap overflow-hidden text-ellipsis border-r border-border/20 font-mono text-text"
                      style={{ width: `${resolvedWidths[col.name]}px`, minWidth: `${resolvedWidths[col.name]}px` }}
                    >
                      {val === null ? <span className="text-muted/50 italic">null</span> : String(val)}
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
    const cellLength = String(row?.[column.name] ?? '').length;
    return Math.max(max, Math.min(cellLength * 8 + 28, 420));
  }, 0);

  return Math.max(headerWidth, sampleWidth, 140);
}
