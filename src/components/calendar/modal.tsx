"use client";

import { useEffect, useRef } from "react";

// A native <dialog>: focus is trapped and Escape closes it (NFR-9).
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg bg-[var(--background)] p-4 text-[var(--foreground)] backdrop:bg-black/40"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          aria-label="Close"
          className="rounded px-2 text-xl leading-none"
          onClick={() => ref.current?.close()}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
