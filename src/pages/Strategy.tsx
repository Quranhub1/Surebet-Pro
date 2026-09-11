import React from 'react';
import { Target, CheckCircle2, Clock, Activity } from 'lucide-react';

const strategies = [
  { title: 'Pure Arbitrage', description: 'Compare the best prices across active bookmakers and calculate stakes so every listed outcome is covered.', icon: Target },
  { title: 'Automatic Cycles', description: 'The backend discovers upcoming leagues and matches every 12 hours without a manual run control.', icon: Clock },
  { title: 'Live Monitoring', description: 'Matches in progress are refreshed continuously and live arbitrage opportunities are recalculated every 2 minutes.', icon: Activity },
];

export function Strategy() {
  return <div className="p-6 md:p-10 w-full max-w-6xl mx-auto"><h1 className="text-3xl font-extrabold text-slate-900">Strategy</h1><p className="text-slate-500 mt-2 mb-10">Surebet Pro uses a deterministic arbitrage engine backed by Neon PostgreSQL.</p><div className="grid md:grid-cols-3 gap-6">{strategies.map(({ title, description, icon: Icon }) => <div key={title} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm"><Icon className="w-7 h-7 text-indigo-600 mb-5" /><h2 className="text-lg font-bold text-slate-900 mb-2">{title}</h2><p className="text-sm text-slate-500 leading-6">{description}</p><div className="mt-5 flex items-center gap-2 text-sm font-bold text-emerald-600"><CheckCircle2 className="w-4 h-4" />Active</div></div>)}</div></div>;
}
