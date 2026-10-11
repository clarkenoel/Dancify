import { useEffect, useRef } from 'react';

// Figma confirmation states: 16-1745, 16-1810, 36-883.
export function ConfirmDialog({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal(); cancel.current?.focus();
    return () => { element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby="confirmation-title" onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id="confirmation-title">{title}</h2>
    <p>The current round will end. Your unfinished score will not be saved.</p>
    <div className="action-row"><button ref={cancel} data-controller onClick={onCancel}>Cancel</button><button className="primary" data-controller onClick={onConfirm}>Confirm</button></div>
    <p className="help">Cancelling keeps the round paused. Confirm Ready when you want to continue.</p>
  </dialog>;
}
