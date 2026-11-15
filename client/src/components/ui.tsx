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
        'inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-3 text-xs' : 'h-9 px-4 text-sm',
        variant === 'primary' && 'bg-indigo-600 text-white hover:bg-indigo-500',
        variant === 'secondary' && 'bg-gray-100 text-gray-900 hover:bg-gray-200',
        variant === 'ghost' && 'text-indigo-600 hover:bg-indigo-50',
        variant === 'danger' && 'bg-red-500 text-white hover:bg-red-600',
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
      className={clsx('inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-xs font-medium', className)}
      style={{ background: `${color || '#94a3b8'}1f`, color: '#1d1d1f' }}
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
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/25 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div className={clsx('w-full rounded-2xl bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] ring-1 ring-black/5', width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-2">
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-gray-100 p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800">
            <X className="size-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 pt-2 pb-5">{footer}</div>}
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
    <div className="flex min-h-12 shrink-0 flex-wrap items-end justify-between gap-3 px-6 pt-7 pb-4">
      <h1 className="flex items-center gap-2.5 text-[28px] leading-none font-bold tracking-tight">
        {icon && <span className="text-indigo-600 [&_svg]:size-6">{icon}</span>}
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
            'absolute z-40 mt-1.5 max-h-80 min-w-48 overflow-y-auto rounded-xl bg-white/95 p-1.5 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.3)] ring-1 ring-black/5 backdrop-blur-xl',
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
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-indigo-600 hover:text-white',
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
        'fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full px-5 py-2.5 text-sm text-white shadow-xl',
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
