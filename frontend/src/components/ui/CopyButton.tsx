/**
 * Copy-to-clipboard control with confirmation.
 *
 * The confirmation matters more than it looks: a copy button with no feedback
 * leaves the user unsure whether it fired, so they press it again. State resets
 * after two seconds, and the result is announced in a live region for screen
 * readers rather than only shown as a colour change.
 *
 * Falls back to a hidden textarea + `execCommand` because `navigator.clipboard`
 * requires a secure context — over plain HTTP on a LAN address, which is how a
 * dispatch box is often reached, it is simply undefined.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

type CopyState = 'idle' | 'copied' | 'failed';

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }

  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    scratch.remove();
    return ok;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  /** The text placed on the clipboard. */
  value: string;
  /** What is being copied, e.g. "trip ID" — used in the label and the tooltip. */
  what: string;
  /** Show the label beside the icon instead of icon-only. */
  showLabel?: boolean;
}

export function CopyButton({ value, what, showLabel = false }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    const ok = await writeToClipboard(value);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  }, [value]);

  const label =
    state === 'copied'
      ? `Copied ${what}`
      : state === 'failed'
        ? `Could not copy ${what}`
        : `Copy ${what}`;

  return (
    <>
      <button
        type="button"
        onClick={copy}
        title={label}
        aria-label={label}
        className={[
          'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
          state === 'copied'
            ? 'bg-green-50 text-green-700'
            : state === 'failed'
              ? 'bg-red-50 text-red-700'
              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900',
        ].join(' ')}
      >
        {state === 'copied' ? (
          <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} />
        ) : (
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
        )}
        {showLabel && <span>{state === 'copied' ? 'Copied' : `Copy ${what}`}</span>}
      </button>
      {/* Announced without moving focus. */}
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? `${what} copied to clipboard` : ''}
      </span>
    </>
  );
}
