import { useEffect, useId, useRef, type ReactNode } from 'react';

/** A separate screen without remounting the reference video or camera. */
export function ToolsDialog({ title, subtitle, onClose, children, open = true }: {
  open?: boolean; title: string; subtitle: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal(); heading.current?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return <dialog className="tools-screen" ref={ref} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="tools-header"><span className="wordmark">Dancify</span><button data-controller onClick={onClose}>Back</button></header>
    <h1 id={id} ref={heading} tabIndex={-1}>{title}</h1><p className="tools-subtitle">{subtitle}</p>
    <div className="tools-board">{children}</div>
  </dialog>;
}
