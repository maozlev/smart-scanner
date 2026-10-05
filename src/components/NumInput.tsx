'use client';

import { useEffect, useState } from 'react';

function parse(text: string, decimals: boolean): number | null {
  const compact = text.replace(/[,\s]/g, '');
  if (compact === '') return null;
  const n = Number(compact);
  if (!Number.isFinite(n) || n < 0) return null;
  return decimals ? n : Math.round(n);
}

interface Props {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  placeholder?: string;
  decimals?: boolean;
  onEnter?: () => void;
  autoFocus?: boolean;
}

export function NumInput({ value, onChange, label, placeholder = '', decimals = false, onEnter, autoFocus = false }: Props) {
  const [text, setText] = useState(value === null ? '' : String(value));

  // Follow outside changes (paste, import, load) without fighting the user's own typing.
  useEffect(() => {
    setText((current) => (parse(current, decimals) === value ? current : value === null ? '' : String(value)));
  }, [value, decimals]);

  return (
    <input
      type="text"
      inputMode={decimals ? 'decimal' : 'numeric'}
      dir="ltr"
      aria-label={label}
      placeholder={placeholder}
      autoFocus={autoFocus}
      enterKeyHint={onEnter ? 'next' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value, decimals));
      }}
    />
  );
}
