'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Cross, LayoutDashboard, ShoppingCart, Pill, Inbox, BarChart3, Settings,
  Wifi, WifiOff, LogOut, Menu, X, Receipt,
} from 'lucide-react';
import { db, getSettings, seedIfEmpty } from '@/lib/db';
import { isDemoMode, startSync, supabase } from '@/lib/supabase';
import { setSoundEnabled, sounds } from '@/lib/sounds';
import Assistant from '@/components/Assistant';
import { useLiveQuery } from 'dexie-react-hooks';
import { CAN, getRole, ROLE_LABEL, RoleContext } from '@/lib/role';
import type { Role } from '@/lib/types';
import { Users, Truck } from 'lucide-react';

const NAV: Array<{ href: string; label: string; icon: typeof LayoutDashboard; show?: (r: Role) => boolean }> = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/pos', label: 'Sell', icon: ShoppingCart },
  { href: '/dashboard/inventory', label: 'Inventory', icon: Pill },
  { href: '/dashboard/orders', label: 'Online orders', icon: Inbox },
  { href: '/dashboard/sales', label: 'Sales & refunds', icon: Receipt, show: CAN.processRefunds },
  { href: '/dashboard/customers', label: 'Customers', icon: Users, show: CAN.manageDirectory },
  { href: '/dashboard/suppliers', label: 'Suppliers', icon: Truck, show: CAN.manageDirectory },
  { href: '/dashboard/reports', label: 'Reports', icon: BarChart3, show: CAN.viewReports },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings, show: CAN.manageSettings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>('cashier');
  const newOrders = useLiveQuery(() => db.orders.where('status').equals('new').count(), [], 0);

  useEffect(() => {
    void seedIfEmpty();
    void getRole().then(setRole);
    void getSettings().then((s) => {
      setSoundEnabled(s.soundOn);
      document.documentElement.classList.toggle('dark', s.darkMode);
    });
    startSync(() => sounds.add());
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); };
  }, []);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    sessionStorage.removeItem('vitcare-demo-user');
    router.push('/login');
  }

  const nav = (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.filter((n) => !n.show || n.show(role)).map(({ href, label, icon: Icon }) => {
        const active = path === href;
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition
              ${active ? 'bg-leaf/15 text-leaf-soft' : 'text-mint/70 hover:bg-white/5 hover:text-mint'}`}>
            <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
            {label}
            {href === '/dashboard/orders' && (newOrders ?? 0) > 0 && (
              <span className="ml-auto chip bg-leaf text-fir-deep">{newOrders}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh flex bg-paper dark:bg-[#071726]">
      {/* Sidebar */}
      <aside className={`fixed lg:static z-40 inset-y-0 left-0 w-64 bg-fir-deep text-white flex-col
        transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'} flex`}>
        <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
          <div className="w-9 h-9 rounded-xl bg-leaf grid place-items-center">
            <Cross className="w-5 h-5 text-fir-deep" />
          </div>
          <div>
            <p className="font-display font-bold leading-tight">Vitcare POS</p>
            <p className="text-[10px] text-mint/50 -mt-0.5">{ROLE_LABEL[role]}</p>
          </div>
          <button className="ml-auto lg:hidden p-1" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="py-4 flex-1 overflow-y-auto">{nav}</div>
        <div className="p-4 border-t border-white/10 space-y-3">
          <div className={`flex items-center gap-2 text-xs ${online ? 'text-leaf-soft' : 'text-amber-warn'}`}>
            {online ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {online ? (isDemoMode ? 'Online · demo mode (local data)' : 'Online · synced') : 'Offline · sales queue locally'}
          </div>
          <button onClick={signOut} className="flex items-center gap-2 text-xs text-mint/60 hover:text-mint">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="lg:hidden sticky top-0 z-20 h-14 bg-fir-deep text-white flex items-center px-4 gap-3">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="w-6 h-6" /></button>
          <span className="font-display font-bold">Vitcare POS</span>
          <span className={`ml-auto ${online ? 'text-leaf-soft' : 'text-amber-warn'}`}>
            {online ? <Wifi className="w-5 h-5" /> : <WifiOff className="w-5 h-5" />}
          </span>
        </header>
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <RoleContext.Provider value={role}>{children}</RoleContext.Provider>
        </main>
      </div>

      <Assistant />
    </div>
  );
}
