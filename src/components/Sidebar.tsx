import React from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Calculator, Bell, Settings, ShieldAlert, TrendingUp, LogOut, Target } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { icon: Activity, label: 'Live Scanner', path: '/' },
  { icon: Target, label: 'Strategy', path: '/strategy' },
  { icon: Calculator, label: 'Calculator', path: '/calculator' },
  { icon: Bell, label: 'My Alerts', path: '/alerts' },
  { icon: TrendingUp, label: 'Reports', path: '/reports' },
  { icon: ShieldAlert, label: 'Admin (Engine)', path: '/admin' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export function Sidebar() {
  const { profile, signOut } = useAuth();

  return (
    <aside className="w-64 bg-[#111111] border-r border-[#222] h-screen flex flex-col z-10">
      <div className="p-6 flex items-center gap-3 border-b border-[#222]">
        <div className="w-8 h-8 rounded-lg bg-[#39FF14] flex items-center justify-center shadow-[0_0_15px_rgba(57,255,20,0.3)]">
          <Activity className="text-black w-5 h-5" strokeWidth={2.5} />
        </div>
        <span className="text-white font-extrabold text-xl tracking-tight">Surebet<span className="text-[#39FF14]">Pro</span></span>
      </div>
      
      <nav className="flex-1 px-3 py-6 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => clsx(
              "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200",
              isActive 
                ? "bg-[#39FF14]/10 text-[#39FF14]" 
                : "text-gray-400 hover:bg-[#1a1a1a] hover:text-white"
            )}
          >
            <item.icon className={clsx("w-5 h-5", "transition-colors")} />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-[#222] space-y-4 bg-[#0a0a0a]/50">
        <div className="bg-[#1a1a1a] border border-[#333] rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1 truncate font-medium">{profile?.email}</div>
          <div className="text-sm font-bold text-white mb-3 capitalize">{profile?.plan || 'Free'} Plan</div>
          {profile?.plan === 'free' && (
            <button className="w-full py-2 bg-[#222] hover:bg-[#333] text-white text-xs font-bold rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-[#39FF14]">
              Upgrade Plan
            </button>
          )}
        </div>
        
        <button 
          onClick={signOut}
          className="flex items-center gap-3 px-4 py-2 w-full rounded-xl text-sm font-medium text-gray-400 hover:bg-red-500/10 hover:text-red-500 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <LogOut className="w-5 h-5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
