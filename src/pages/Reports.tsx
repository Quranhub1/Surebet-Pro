import React, { useState, useEffect } from 'react';
import { TrendingUp, DollarSign, Target, Activity, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, isSameDay } from 'date-fns';
import { enUS } from 'date-fns/locale';

export function Reports() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ totalWon: 0, totalLost: 0, avgRoi: 0, totalProfit: 0 });
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchStats();
  }, [user]);

  const fetchStats = async () => {
    try {
      const { data, error } = await supabase
        .from('user_strategies')
        .select(`status, expected_profit, created_at, surebet_opportunities(roi)`)
        .eq('user_id', user?.id);

      if (error) throw error;

      if (data) {
        const wonStrategies = data.filter(d => d.status === 'won');
        const lostStrategies = data.filter(d => d.status === 'lost');
        const totalWon = wonStrategies.length;
        const totalLost = lostStrategies.length;
        const rois = wonStrategies.map(d => Number(d.surebet_opportunities?.roi || 0));
        const avgRoi = rois.length > 0 ? rois.reduce((a,b) => a + b, 0) / rois.length : 0;
        const totalProfit = wonStrategies.reduce((sum, curr) => sum + Number(curr.expected_profit || 0), 0);
        setStats({ totalWon, totalLost, avgRoi, totalProfit });

        const last7Days = Array.from({length: 7}).map((_, i) => subDays(new Date(), 6 - i));
        const newChartData = last7Days.map(date => {
          const dayStr = format(date, 'EEE', { locale: enUS });
          const dayProfit = wonStrategies
            .filter(s => isSameDay(new Date(s.created_at), date))
            .reduce((sum, s) => sum + Number(s.expected_profit || 0), 0);

          return { 
            name: dayStr,
            profit: Number(dayProfit.toFixed(2)) 
          };
        });

        setChartData(newChartData);
      }
    } catch (error) {
      console.error('Error fetching statistics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="w-10 h-10 text-[#39FF14] animate-spin" /></div>;

  return (
    <div className="p-6 md:p-10 w-full max-w-7xl mx-auto pb-24">
      <div className="flex items-center gap-4 mb-2">
        <div className="w-12 h-12 rounded-xl bg-[#39FF14]/10 flex items-center justify-center border border-[#39FF14]/20 shadow-sm">
          <TrendingUp className="w-6 h-6 text-[#39FF14]" />
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Performance Reports</h1>
      </div>
      <p className="text-[#8b8d93] text-sm font-medium mb-10 ml-16">Detailed analysis of your strategies and real profits.</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        <div className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4"><div className="w-10 h-10 rounded-lg bg-[#39FF14]/10 flex items-center justify-center"><Target className="w-5 h-5 text-[#39FF14]" /></div></div>
          <div className="text-gray-500 text-sm font-bold mb-1 uppercase">Won Operations</div>
          <div className="text-3xl font-black text-white">{stats.totalWon}</div>
        </div>
        <div className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4"><div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center"><Activity className="w-5 h-5 text-red-500" /></div></div>
          <div className="text-gray-500 text-sm font-bold mb-1 uppercase">Lost Operations</div>
          <div className="text-3xl font-black text-white">{stats.totalLost}</div>
        </div>
        <div className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4"><div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-blue-500" /></div></div>
          <div className="text-gray-500 text-sm font-bold mb-1 uppercase">Average ROI (Won)</div>
          <div className="text-3xl font-black text-white">{stats.avgRoi.toFixed(2)}%</div>
        </div>
        <div className="bg-[#161618] border border-[#39FF14]/30 rounded-2xl p-6 shadow-[0_0_20px_rgba(57,255,20,0.05)] relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-[#39FF14]/10 rounded-full blur-2xl"></div>
          <div className="flex items-center justify-between mb-4 relative z-10"><div className="w-10 h-10 rounded-lg bg-[#39FF14] flex items-center justify-center"><DollarSign className="w-5 h-5 text-black" /></div></div>
          <div className="text-[#39FF14] text-sm font-bold mb-1 uppercase relative z-10">Total Profit</div>
          <div className="text-3xl font-black text-white relative z-10">R$ {stats.totalProfit.toFixed(2)}</div>
        </div>
      </div>

      <div className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-6 shadow-lg">
        <h2 className="text-lg font-bold text-white mb-6">Profit Trend (Last 7 Days)</h2>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
              <XAxis dataKey="name" stroke="#888" tick={{fill: '#888'}} axisLine={false} tickLine={false} />
              <YAxis stroke="#888" tick={{fill: '#888'}} axisLine={false} tickLine={false} tickFormatter={(val) => `R$${val}`} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '8px' }}
                itemStyle={{ color: '#39FF14', fontWeight: 'bold' }}
                formatter={(value: number) => [`R$ ${value.toFixed(2)}`, 'Profit']}
              />
              <Line type="monotone" dataKey="profit" stroke="#39FF14" strokeWidth={4} dot={{ r: 6, fill: '#111', stroke: '#39FF14', strokeWidth: 2 }} activeDot={{ r: 8 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
