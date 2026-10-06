import { useEffect, useRef, type ReactNode } from 'react';
import { common } from '@/copy/common';
import { IconX } from './icons';

/** Accessible modal built on <dialog> (focus trap + Escape handled by the browser). */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  dismissible = true,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-testid={testId}
      aria-labelledby="modal-title"
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      className="w-[min(92vw,560px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40"
    >
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 id="modal-title" className="text-xl font-bold">
              {title}
            </h2>
            {dismissible ? (
              <button
                type="button"
                onClick={onClose}
                aria-label={common.close}
                className="inline-flex min-h-touch min-w-touch items-center justify-center rounded-xl hover:bg-bg"
              >
                <IconX />
              </button>
            ) : null}
          </div>
          <div className="space-y-4">{children}</div>
          {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
