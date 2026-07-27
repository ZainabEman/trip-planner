/**
 * Confirmation dialog for destructive actions.
 *
 * Uses the native `<dialog>` element via `showModal()`, which gives focus
 * trapping, Escape-to-close, inert background and the top layer for free —
 * all of which a hand-rolled overlay has to reimplement and usually gets wrong.
 *
 * The confirm button is *not* autofocused: focus lands on Cancel, so an
 * accidental Enter dismisses rather than deletes.
 */
import { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, stated plainly. */
  message: string;
  /** Extra detail — the record being acted on. */
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  detail,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelId = useId();

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      // Safest default: Escape or Enter both back out.
      document.getElementById(cancelId)?.focus();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open, cancelId]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      // Clicking the backdrop (the dialog element itself, outside its child) closes.
      onClick={(event) => {
        if (event.target === dialog.current && !busy) onCancel();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-gray-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="p-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"
          >
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            <p id="confirm-message" className="mt-1 text-sm leading-relaxed text-slate-600">
              {message}
            </p>
            {detail && (
              <p className="mt-2 truncate rounded-md bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-600">
                {detail}
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button id={cancelId} variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
