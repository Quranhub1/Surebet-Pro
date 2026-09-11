import React, { useState, useEffect } from 'react';
import { Search, Loader2, AlertCircle, Radar } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { OpportunityCard, OpportunityCardSkeleton } from '../components/OpportunityCard';
import { CalculatorModal } from '../components/CalculatorModal';
import { runManualScan } from '../lib/manualScanner';

interface SurebetLeg {
  id: string;
  outcome_name: string;
  bookmaker: string;
  price: number;
  stake_percentage: number;
}

interface EventData {
  home_team: string;
  away_team: string;
  commence_time: string;
  league_title: string;
  sport_key: string;
}

interface Opportunity {
  id: string;
  market_key: string;
  roi: number;
  profit: number;
  created_at: string;
  events: EventData;
  surebet_legs: SurebetLeg[];
}

export function Dashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanError, setScanError] = useState('');

  useEffect(() => {
    fetchOpportunities();

    const channel = supabase
      .channel('public:surebet_opportunities')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'surebet_opportunities' }, () => {
        fetchOpportunities();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchOpportunities = async () => {
    try {
      const { data, error } = await supabase
        .from('surebet_opportunities')
        .select(`
          id,
          market_key,
          roi,
          profit,
          created_at,
          events (
            home_team,
            away_team,
            commence_time,
            league_title,
            sport_key
          ),
          surebet_legs (
            id,
            outcome_name,
            bookmaker,
            price,
            stake_percentage
          )
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOpportunities((data as unknown as Opportunity[]) || []);
    } catch (error) {
      console.error('Error fetching opportunities:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleManualScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanStatus('Starting scanner...');
    setScanError('');
    
    try {
      const found = await runManualScan((status) => setScanStatus(status));
      if (found > 0) {
        setScanStatus(`Success! ${found} new opportunities found.`);
      } else {
        setScanStatus('No opportunities meeting the minimum ROI were found.');
      }
      setTimeout(() => {
        setIsScanning(false);
        setScanStatus('');
      }, 4000);
    } catch (error: any) {
      setIsScanning(false);
      setScanStatus('');
      setScanError(error.message);
    }
  };

  const filteredBets = opportunities.filter(bet => {
    const eventName = `${bet.events?.home_team} vs ${bet.events?.away_team}`.toLowerCase();
    const leagueName = bet.events?.league_title?.toLowerCase() || '';
    const search = searchTerm.toLowerCase();
    return eventName.includes(search) || leagueName.includes(search);
  });

  const handleOpenCalculator = (id: string) => {
    const opp = opportunities.find(o => o.id === id);
    if (opp) {
      setSelectedOpportunity(opp);
      setIsModalOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-6 md:p-10">
      <div className="w-full max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div className="flex-1 w-full">
            <h1 className="text-3xl font-extrabold text-white tracking-tight mb-1 flex items-center gap-3 flex-wrap">
              Live Scanner
              {isScanning && scanStatus && (
                <span className="text-xs font-bold bg-[#39FF14]/10 text-[#39FF14] px-3 py-1 rounded-full border border-[#39FF14]/20 animate-pulse flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {scanStatus}
                </span>
              )}
            </h1>
            <p className="text-[#8b8d93] text-sm font-medium mb-3">Real-time arbitrage monitoring.</p>
            {scanError && (
              <div className="text-xs font-bold bg-red-500/10 text-red-500 px-4 py-3 rounded-xl border border-red-500/20 flex items-start gap-3 animate-in fade-in slide-in-from-left-2 w-full max-w-3xl">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span className="break-words whitespace-pre-wrap leading-relaxed">{scanError}</span>
              </div>
            )}
          </div>
          
          <div className="flex w-full md:w-auto gap-3 flex-col sm:flex-row items-start">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8b8d93]" />
              <input 
                type="text" 
                placeholder="Search teams or leagues..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#161618] border border-[#2c2e33] text-white text-sm rounded-xl pl-10 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#39FF14] focus:border-transparent transition-all placeholder-[#4a4d55]"
              />
            </div>
            
            <button 
              onClick={handleManualScan}
              disabled={isScanning}
              className="bg-[#1a2e15] hover:bg-[#223d1c] border border-[#2a4a22] text-[#39FF14] px-5 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_15px_rgba(57,255,20,0.1)] hover:shadow-[0_0_20px_rgba(57,255,20,0.2)] whitespace-nowrap"
            >
              {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
              {isScanning ? 'Scanning...' : 'Scan Now'}
            </button>
          </div>
        </div>

        {!isScanning && scanStatus && !scanError && (
          <div className="mb-6 bg-[#161618] border border-[#2c2e33] rounded-xl p-4 text-sm text-gray-300 flex items-center gap-3 animate-in fade-in">
            <AlertCircle className="w-5 h-5 text-[#39FF14]" />
            {scanStatus}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {[1, 2, 3, 4].map(i => <OpportunityCardSkeleton key={i} />)}
          </div>
        ) : filteredBets.length === 0 ? (
          <div className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-16 text-center shadow-lg">
            <div className="flex flex-col items-center justify-center text-[#8b8d93]">
              <div className="w-16 h-16 bg-[#252529] rounded-full flex items-center justify-center mb-4 border border-[#333]">
                <Radar className="w-8 h-8 text-[#555]" />
              </div>
              <p className="text-xl font-bold text-white mb-2">No surebets found right now</p>
              <p className="text-sm max-w-md text-center leading-relaxed mb-6">
                The market is dynamic. Click "Scan Now" to force a scan across the active bookmakers.
              </p>
              <button 
                onClick={handleManualScan}
                disabled={isScanning}
                className="bg-[#39FF14] text-black px-6 py-3 rounded-xl text-sm font-extrabold flex items-center justify-center gap-2 hover:bg-[#6BFF4D] transition-all disabled:opacity-50 shadow-[0_0_15px_rgba(57,255,20,0.3)]"
              >
                {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
                Scan Market Now
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {filteredBets.map((bet) => (
              <OpportunityCard
                key={bet.id}
                id={bet.id}
                roi={bet.roi}
                sport={bet.events?.sport_key}
                date={bet.events?.commence_time}
                league={bet.events?.league_title}
                homeTeam={bet.events?.home_team}
                awayTeam={bet.events?.away_team}
                legs={bet.surebet_legs.map(leg => ({
                  id: leg.id,
                  bookmaker: leg.bookmaker,
                  outcome: leg.outcome_name,
                  price: leg.price
                }))}
                onCalculate={handleOpenCalculator}
                fullData={bet}
              />
            ))}
          </div>
        )}
      </div>

      <CalculatorModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        opportunity={selectedOpportunity} 
      />
    </div>
  );
}
