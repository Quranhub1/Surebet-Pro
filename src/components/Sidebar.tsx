import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Calculator, Bell, Settings, ShieldAlert, TrendingUp, LogOut, Target, X, PanelLeftClose, PanelLeftOpen, CreditCard, CheckCircle2, Clock3 } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth, getAuthToken } from '../contexts/AuthContext';

const navItems = [
  { icon: Activity, label: 'Live Scanner', path: '/' },
  { icon: Target, label: 'Strategy', path: '/strategy' },
  { icon: Calculator, label: 'Calculator', path: '/calculator' },
  { icon: Bell, label: 'My Alerts', path: '/alerts' },
  { icon: TrendingUp, label: 'Reports', path: '/reports' },
  { icon: ShieldAlert, label: 'Admin Dashboard', path: '/admin', adminOnly: true },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function Sidebar({ collapsed, mobileOpen, onToggleCollapsed, onCloseMobile }: { collapsed: boolean; mobileOpen: boolean; onToggleCollapsed: () => void; onCloseMobile: () => void; }) {
  const { profile, signOut, refreshSession } = useAuth();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const isAdmin = ['ADMIN', 'SUPERADMIN', 'OWNER'].includes(String(profile?.role || '').toUpperCase());
  const visibleItems = navItems.filter(item => !item.adminOnly || isAdmin);
  const status = String(profile?.subscriptionStatus || 'trial').toLowerCase();
  const isTrial = status === 'trial';
  const isPending = status === 'pending';
  const isActive = status === 'active';
  const trialEnds = profile?.trialEndsAt ? new Date(profile.trialEndsAt) : null;
  const trialExpired = isTrial && trialEnds && trialEnds.getTime() <= Date.now();
  const showPayment = !isActive && (trialExpired || isPending || status === 'free');
  const planLabel = isActive ? 'PRO' : isTrial && !trialExpired ? '3-Day Trial' : isPending ? 'Payment Pending' : 'FREE';

  const openPayment = () => { setMessage(''); setPaymentOpen(true); };
  const markPaid = async () => {
    setSending(true); setMessage('');
    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/subscription/request-payment`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to submit payment request');
      await refreshSession();
      setMessage('Payment request sent. Waiting for admin approval.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to submit payment request'); }
    finally { setSending(false); }
  };

  return (
    <>
      {mobileOpen && <button aria-label="Close navigation" onClick={onCloseMobile} className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden" />}
      <aside className={clsx('fixed md:relative inset-y-0 left-0 z-50 md:z-10 flex h-screen flex-col border-r border-[#222] bg-[#111111] transition-all duration-300 ease-in-out', collapsed ? 'md:w-20' : 'md:w-64', mobileOpen ? 'translate-x-0 w-72' : '-translate-x-full md:translate-x-0')}>
        <div className={clsx('flex items-center border-b border-[#222]', collapsed ? 'justify-center p-4' : 'justify-between p-5')}>
          <div className="flex items-center gap-3 min-w-0"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#39FF14] shadow-[0_0_15px_rgba(57,255,20,0.3)]"><Activity className="h-5 w-5 text-black" strokeWidth={2.5} /></div>{!collapsed && <span className="text-xl font-extrabold tracking-tight text-white">Surebet<span className="text-[#39FF14]">Pro</span></span>}</div>
          <button onClick={onCloseMobile} aria-label="Close navigation" className="rounded-lg p-2 text-gray-400 hover:bg-[#1a1a1a] hover:text-white md:hidden"><X className="h-5 w-5" /></button>
        </div>
        <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-5">{visibleItems.map(item => <NavLink key={item.path} to={item.path} onClick={onCloseMobile} title={collapsed ? item.label : undefined} className={({ isActive }) => clsx('flex items-center rounded-xl py-2.5 text-sm font-semibold transition-all duration-200', collapsed ? 'justify-center px-2' : 'gap-3 px-4', isActive ? 'bg-[#39FF14]/10 text-[#39FF14]' : 'text-gray-400 hover:bg-[#1a1a1a] hover:text-white')}><item.icon className="h-5 w-5 shrink-0" />{!collapsed && <span className="truncate">{item.label}</span>}</NavLink>)}</nav>
        <div className={clsx('space-y-3 border-t border-[#222] bg-[#0a0a0a]/50 p-3', collapsed && 'items-center')}>
          {!collapsed && <div className="rounded-xl border border-[#333] bg-[#1a1a1a] p-4"><div className="mb-1 truncate text-xs font-medium text-gray-500">{profile?.email}</div><div className="mb-2 text-sm font-bold text-white">{planLabel}</div>{isTrial && !trialExpired && trialEnds && <div className="mb-3 text-xs text-gray-400">Trial ends {trialEnds.toLocaleString()}</div>}{isPending && <div className="mb-3 flex items-center gap-2 text-xs text-amber-300"><Clock3 className="h-4 w-4" />Awaiting admin approval</div>}{showPayment && !isPending && <button onClick={openPayment} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#39FF14] py-2 text-xs font-extrabold text-black hover:bg-[#52ff35]"><CreditCard className="h-4 w-4" />Pay UGX 5,000</button>}{isPending && <button onClick={openPayment} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#222] py-2 text-xs font-bold text-white hover:bg-[#333]">View payment status</button>}</div>}
          <div className="flex gap-2"><button onClick={signOut} title="Sign Out" className={clsx('flex flex-1 items-center rounded-xl py-2 text-sm font-medium text-gray-400 hover:bg-red-500/10 hover:text-red-500', collapsed ? 'justify-center px-2' : 'gap-3 px-4')}><LogOut className="h-5 w-5" />{!collapsed && 'Sign Out'}</button><button onClick={onToggleCollapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="hidden rounded-xl p-2 text-gray-400 hover:bg-[#1a1a1a] hover:text-white md:block">{collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}</button></div>
        </div>
      </aside>
      {paymentOpen && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true"><div className="w-full max-w-md rounded-2xl border border-[#333] bg-[#111] p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between gap-4"><div><div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-[#39FF14]/10 text-[#39FF14]"><CreditCard className="h-5 w-5" /></div><h2 className="text-xl font-extrabold text-white">Upgrade to Pro</h2><p className="mt-1 text-sm text-gray-400">Your free 3-day access has ended. Pay UGX 5,000 to activate Pro for 30 days.</p></div><button onClick={() => setPaymentOpen(false)} aria-label="Close payment prompt" className="rounded-lg p-2 text-gray-400 hover:bg-[#1a1a1a] hover:text-white"><X className="h-5 w-5" /></button></div><div className="mb-5 rounded-xl border border-[#2d2d2d] bg-[#171717] p-4"><div className="text-sm text-gray-400">Send payment via Mobile Money</div><div className="mt-2 text-2xl font-extrabold text-[#39FF14]">UGX 5,000</div><div className="mt-2 text-lg font-bold text-white">0749846848</div><div className="text-sm text-gray-400">Kabali Madina</div></div>{isPending ? <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-200">Your payment request is pending admin approval. Do not submit another request.</div> : <><div className="mb-4 text-sm leading-6 text-gray-300">After completing the payment, tap <strong className="text-white">I've Paid</strong>. Your request will appear in the Admin Dashboard and your Pro access will remain pending until an administrator approves it.</div><button onClick={markPaid} disabled={sending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#39FF14] py-3 text-sm font-extrabold text-black disabled:opacity-60">{sending ? 'Sending request...' : "I've Paid"}</button></>}{message && <div className="mt-4 rounded-xl bg-[#171717] p-3 text-sm text-gray-200">{message}</div>}<button onClick={() => setPaymentOpen(false)} className="mt-3 w-full rounded-xl bg-[#222] py-3 text-sm font-bold text-white hover:bg-[#333]">Close</button></div></div>}
    </>
  );
}
