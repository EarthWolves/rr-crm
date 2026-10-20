import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Loader2, X } from 'lucide-react';
import type { User } from '../api';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-sm',
        variant === 'primary' && 'bg-gray-900 text-white shadow-sm hover:bg-gray-800',
        variant === 'secondary' && 'border border-gray-200 bg-white text-gray-700 shadow-xs hover:bg-gray-50',
        variant === 'ghost' && 'text-gray-600 hover:bg-gray-100',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-500',
        className,
      )}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('size-5 animate-spin text-gray-400', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-full items-center justify-center py-20">
      <Spinner />
    </div>
  );
}

export function Avatar({ user, size = 20 }: { user?: Pick<User, 'name' | 'color'> | null; size?: number }) {
  if (!user) {
    return <span className="inline-block shrink-0 rounded-full border border-dashed border-gray-300" style={{ width: size, height: size }} />;
  }
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      title={user.name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: user.color, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  );
}

export function Pill({ color, children, className }: { color?: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx('inline-flex max-w-full items-center gap-1.5 truncate rounded-md border px-1.5 py-0.5 text-xs font-medium', className)}
      style={{ borderColor: `${color || '#94a3b8'}55`, background: `${color || '#94a3b8'}1a`, color: '#374151' }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: color || '#94a3b8' }} />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-gray-900/30 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div className={clsx('w-full rounded-xl bg-white shadow-2xl ring-1 ring-gray-200', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="mb-1 text-gray-300">{icon}</div>}
      <div className="font-medium text-gray-700">{title}</div>
      {children && <div className="max-w-sm text-sm text-gray-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, icon, children }: { title: ReactNode; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-2">
      <h1 className="flex items-center gap-2 text-[15px] font-semibold">
        {icon && <span className="text-gray-500">{icon}</span>}
        {title}
      </h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

// Lightweight dropdown menu anchored to its trigger.
export function Menu({ trigger, children, align = 'left' }: { trigger: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={clsx(
            'absolute z-40 mt-1 max-h-80 min-w-48 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ onClick, children, danger, active }: { onClick: () => void; children: ReactNode; danger?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-100',
        danger ? 'text-red-600' : 'text-gray-700',
        active && 'bg-gray-100',
      )}
    >
      {children}
    </button>
  );
}

let toastSetter: ((t: { msg: string; error?: boolean } | null) => void) | null = null;

export function toast(msg: string, error = false) {
  toastSetter?.({ msg, error });
}

export function Toaster() {
  const [t, setT] = useState<{ msg: string; error?: boolean } | null>(null);
  useEffect(() => {
    toastSetter = setT;
    return () => {
      toastSetter = null;
    };
  }, []);
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(() => setT(null), 3500);
    return () => clearTimeout(id);
  }, [t]);
  if (!t) return null;
  return (
    <div
      className={clsx(
        'fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg px-4 py-2 text-sm text-white shadow-lg',
        t.error ? 'bg-red-600' : 'bg-gray-900',
      )}
    >
      {t.msg}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
