import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  CheckSquare, Columns3, Home, LogOut, Menu as MenuIcon, PhoneCall, PhoneOutgoing, Settings, Upload, Users, X,
} from 'lucide-react';
import { api } from '../api';
import { useLiveUpdates, useMe, usePipelines } from '../hooks';
import { Avatar } from './ui';

const nav = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/dialer', label: 'Call queue', icon: PhoneOutgoing },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  { to: '/calls', label: 'Call log', icon: PhoneCall },
  { to: '/import', label: 'Import', icon: Upload },
];

const linkCls = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition',
    isActive ? 'bg-gray-200/70 font-medium text-gray-900' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
  );

export default function Layout() {
  const { data: me } = useMe();
  const { pipelines } = usePipelines();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  useLiveUpdates(me?.id);

  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    navigate('/');
    qc.setQueryData(['me'], null);
  };

  const sidebar = (
    <nav className="flex h-full w-60 flex-col border-r border-gray-200 bg-gray-50/80">
      <div className="flex h-12 items-center gap-2 px-4">
        <img src="/favicon.svg" className="size-6" alt="" />
        <span className="font-semibold">RR CRM</span>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-2" onClick={() => setMobileOpen(false)}>
        <div className="space-y-0.5">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={linkCls}>
              <n.icon className="size-4" />
              {n.label}
            </NavLink>
          ))}
        </div>
        <div>
          <div className="flex items-center justify-between px-2 pb-1 text-xs font-medium text-gray-400">
            <NavLink to="/pipelines" className="hover:text-gray-700">
              Pipelines
            </NavLink>
            <NavLink to="/pipelines?new=1" className="rounded px-1 text-base leading-none hover:bg-gray-200 hover:text-gray-700" title="New pipeline">
              +
            </NavLink>
          </div>
          <div className="space-y-0.5">
            {pipelines.map((p) => (
              <NavLink key={p.id} to={`/pipelines/${p.id}`} className={linkCls}>
                <Columns3 className="size-4" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-xs text-gray-400">{p.entry_count}</span>
              </NavLink>
            ))}
            {!pipelines.length && <div className="px-2 py-1 text-xs text-gray-400">No pipelines yet</div>}
          </div>
        </div>
      </div>
      <div className="space-y-0.5 border-t border-gray-200 p-2">
        <NavLink to="/settings" className={linkCls} onClick={() => setMobileOpen(false)}>
          <Settings className="size-4" />
          Settings
        </NavLink>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <Avatar user={me} size={22} />
          <span className="flex-1 truncate text-sm">{me?.name}</span>
          <button onClick={logout} title="Sign out" className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <div className="hidden md:block">{sidebar}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          {sidebar}
          <div className="flex-1 bg-gray-900/30" onClick={() => setMobileOpen(false)}>
            <button className="m-3 rounded bg-white p-1.5">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 items-center gap-2 border-b border-gray-200 px-3 md:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded p-1.5 hover:bg-gray-100">
            <MenuIcon className="size-5" />
          </button>
          <span className="font-semibold">RR CRM</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
