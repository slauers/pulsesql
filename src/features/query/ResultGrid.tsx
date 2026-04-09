import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

interface ResultGridProps {
  columns: string[];
  rows: any[];
}

export default function ResultGrid({ columns, rows }: ResultGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28, // height per row
    overscan: 20,
  });

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
          height: `${rowVirtualizer.getTotalSize() + 32}px`, // +32 for header
          position: 'relative',
        }}
      >
        <div className="flex bg-surface/95 backdrop-blur text-xs font-semibold text-muted sticky top-0 z-10 border-b border-border/90 shadow-[0_8px_24px_rgba(0,0,0,0.18)]" style={{ height: 32 }}>
          <div className="w-14 px-2 py-2 text-center sticky left-0 bg-surface/95 select-none opacity-50 shrink-0 border-r border-border/50">
            #
          </div>
          {columns.map((col, idx) => (
            <div key={idx} className="px-3 py-2 whitespace-nowrap overflow-hidden text-ellipsis min-w-[150px] border-r border-border/50 text-[11px] uppercase tracking-[0.04em]">
              {col}
            </div>
          ))}
        </div>
        
        <div className="absolute w-full top-[32px] divide-y divide-border/30">
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
                  {virtualRow.index + 1}
                </div>
                {columns.map((col, cIdx) => {
                  const val = row[col];
                  return (
                    <div 
                      key={cIdx} 
                      className="px-3 flex items-center whitespace-nowrap overflow-hidden text-ellipsis border-r border-border/20 font-mono text-text min-w-[150px]"
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
