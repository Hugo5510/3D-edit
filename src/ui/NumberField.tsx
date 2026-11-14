import { useEffect, useRef, useState } from 'react';
import { fmt, parseNumber } from '../model/math';

interface Props {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  testId?: string;
  autoFocus?: boolean;
  integer?: boolean;
  /** Zatwierdzenie także przy każdej zmianie tekstu (bez Enter). */
  title?: string;
  disabled?: boolean;
}

/**
 * Pole wymiaru: przyjmuje przecinek lub kropkę i proste działania (np. „20/2+3”).
 * Na telefonie otwiera klawiaturę numeryczną (inputMode=decimal). Enter lub opuszczenie pola zatwierdza.
 */
export function NumberField({ label, value, onChange, unit = 'mm', min, max, step = 1, digits = 2, testId, autoFocus, integer, title, disabled }: Props) {
  const [text, setText] = useState(fmt(value, digits));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false);

  useEffect(() => {
    if (!focused) setText(fmt(value, digits));
  }, [value, focused, digits]);

  const commit = (t = text) => {
    let v = parseNumber(t);
    if (v === null) {
      setBad(true);
      return false;
    }
    if (integer) v = Math.round(v);
    if (min !== undefined && v < min) v = min;
    if (max !== undefined && v > max) v = max;
    v = Math.round(v * 1e6) / 1e6;
    setBad(false);
    setText(fmt(v, digits));
    if (Math.abs(v - value) > 1e-9) onChange(v);
    return true;
  };

  return (
    <label className={'nf' + (bad ? ' bad' : '')} title={title}>
      {label && <span className="nf-label">{label}</span>}
      <span className="nf-box">
        <input
          ref={ref}
          data-testid={testId}
          type="text"
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          disabled={disabled}
          autoFocus={autoFocus}
          value={text}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setFocused(false);
            if (skipBlur.current) skipBlur.current = false;
            else commit();
          }}
          onChange={(e) => {
            setText(e.target.value);
            setBad(parseNumber(e.target.value) === null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              commit();
              skipBlur.current = true;
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              setText(fmt(value, digits));
              skipBlur.current = true;
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const cur = parseNumber(text) ?? value;
              const s = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step;
              const nv = cur + (e.key === 'ArrowUp' ? s : -s);
              setText(fmt(nv, digits));
              commit(String(nv));
            }
          }}
        />
        {unit && <span className="nf-unit">{unit}</span>}
      </span>
    </label>
  );
}
