import React, { useState, useEffect } from 'react';
import { Target, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { format } from 'date-fns';
import { enUS } from 'date-fns/locale';

export function Strategy() {
  const { user } = useAuth();
  const [strategies, setStrategies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchStrategies();
  }, [user]);

  const fetchStrategies = async () => {
    try {
      const { data, error } = await supabase
        .from('user_strategies')
        .select(`
          id,
          status,
          invested_amount,
          expected_profit,
          created_at,
          surebet_opportunities (
            roi,
            market_key,
            events ( home_team, away_team, league_title ),
            surebet_legs ( bookmaker, outcome_name, price )
          )
        `)
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setStrategies(data || []);
    } catch (error) {
      console.error('Error fetching strategies:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, newStatus: string, roi: number = 0) => {
    try {
      let expected_profit = 0;
      let invested_amount = 0;

      if (newStatus === 'won') {
        invested_amount = 1000;
        expected_profit = invested_amount * (roi / 100);
      }

      await supabase
        .from('user_strategies')
        .update({ status: newStatus, invested_amount, expected_profit })
        .eq('id', id);
        
      fetchStrategies();
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="w-10 h-10 text-[#39FF14] animate-spin" /></div>;
  }

  return (
    <div className="p-6 md:p-10 w-full max-w-7xl mx-auto pb-24">
      <div className="flex items-center gap-4 mb-2">
        <div className="w-12 h-12 rounded-xl bg-[#39FF14]/10 flex items-center justify-center border border-[#39FF14]/20 shadow-sm">
          <Target className="w-6 h-6 text-[#39FF14]" />
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">My Strategies</h1>
      </div>
      <p className="text-[#8b8d93] text-sm font-medium mb-10 ml-16">
        Track saved opportunities and manage your results.
      </p>

      {strategies.length === 0 ? (
        <div className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-16 text-center shadow-lg">
          <Target className="w-12 h-12 text-[#444] mx-auto mb-4" />
          <p className="text-xl font-bold text-white mb-2">No strategies saved</p>
          <p className="text-[#8b8d93] text-sm">Click "Add to Strategy" on Live Scanner cards.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {strategies.map((strat) => {
            const opp = strat.surebet_opportunities;
            if (!opp) return null;
            
            return (
              <div key={strat.id} className="bg-[#161618] border border-[#2c2e33] rounded-xl p-5 flex flex-col md:flex-row items-center gap-6 shadow-md hover:border-[#3f424a] transition-colors">
                <div className="flex-1 w-full">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider flex items-center gap-1 ${strat.status === 'pending' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : strat.status === 'won' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'}`}>
                      {strat.status === 'pending' && <Clock className="w-3 h-3" />}
                      {strat.status === 'won' && <CheckCircle2 className="w-3 h-3" />}
                      {strat.status === 'lost' && <XCircle className="w-3 h-3" />}
                      {strat.status === 'pending' ? 'Pending' : strat.status === 'won' ? 'Won' : 'Lost'}
                    </span>
                    <span className="text-gray-500 text-xs">{format(new Date(strat.created_at), "dd MMM, HH:mm", { locale: enUS })}</span>
                  </div>
                  <h3 className="text-lg font-bold text-white">{opp.events?.home_team} vs {opp.events?.away_team}</h3>
                  <p className="text-sm text-gray-400 mt-1">{opp.events?.league_title} • {opp.market_key}</p>
                </div>

                <div className="flex gap-4 md:border-x border-[#333] md:px-6 w-full md:w-auto justify-between">
                  <div className="text-center">
                    <div className="text-xs text-gray-500 font-bold uppercase">Target ROI</div>
                    <div className="text-xl font-black text-[#39FF14]">{Number(opp.roi).toFixed(2)}%</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-gray-500 font-bold uppercase">Bookmakers</div>
                    <div className="text-sm font-medium text-white flex flex-col">
                      {opp.surebet_legs.map((l:any, i:number) => <span key={i}>{l.bookmaker}</span>)}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 w-full md:w-auto">
                  {strat.status === 'pending' && (
                    <>
                      <button onClick={() => updateStatus(strat.id, 'won', Number(opp.roi))} className="flex-1 md:flex-none bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-colors">Mark Won</button>
                      <button onClick={() => updateStatus(strat.id, 'lost')} className="flex-1 md:flex-none bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-colors">Mark Lost</button>
                    </>
                  )}
                  {strat.status !== 'pending' && (
                    <button onClick={() => updateStatus(strat.id, 'pending')} className="w-full bg-[#222] hover:bg-[#333] text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors">Revert</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
