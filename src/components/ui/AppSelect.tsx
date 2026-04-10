import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface AppSelectOption {
  value: string;
  label: string;
}

export default function AppSelect({
  value,
  options,
  onChange,
  placeholder,
  className = '',
  menuClassName = '',
}: {
  value: string;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-left text-sm text-text outline-none transition-colors hover:border-primary/50 focus:border-primary ${className}`}
      >
        <span className={selected ? 'text-text' : 'text-muted'}>
          {selected?.label ?? placeholder ?? 'Selecionar'}
        </span>
        <ChevronDown
          size={16}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180 text-primary' : ''}`}
        />
      </button>

      {open ? (
        <div
          className={`absolute z-50 mt-2 max-h-64 w-full overflow-auto rounded-2xl border border-border/80 bg-surface/95 p-1 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl ${menuClassName}`}
        >
          {options.map((option) => {
            const active = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-primary/12 text-primary'
                    : 'text-text hover:bg-background/55'
                }`}
              >
                <span>{option.label}</span>
                {active ? <Check size={14} className="shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
