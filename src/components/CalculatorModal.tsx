import React, { useState, useEffect } from 'react';
import { X, DollarSign, AlertCircle } from 'lucide-react';

interface CalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  opportunity: any;
}

export function CalculatorModal({ isOpen, onClose, opportunity }: CalculatorModalProps) {
  const [totalBank, setTotalBank] = useState<number>(1000);

  // Prevent body scrolling while the modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen || !opportunity) return null;

  const leg1 = opportunity.surebet_legs[0];
  const leg2 = opportunity.surebet_legs[1];

  const stake1 = totalBank * (Number(leg1.stake_percentage) / 100);
  const stake2 = totalBank * (Number(leg2.stake_percentage) / 100);
  
  const return1 = stake1 * Number(leg1.price);
  const return2 = stake2 * Number(leg2.price);
  
  const guaranteedProfit = ((return1 + return2) / 2) - totalBank;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      ></div>

      {/* Modal Content */}
      <div className="relative bg-[#161618] border border-[#2c2e33] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto z-10 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="sticky top-0 bg-[#161618]/95 backdrop-blur border-b border-[#2c2e33] p-5 md:p-6 flex justify-between items-center z-20">
          <div>
            <h2 className="text-2xl font-extrabold text-white tracking-tight">
              Arbitrage Calculator
            </h2>
            <p className="text-[#8b8d93] text-sm mt-1">
              {opportunity.events?.home_team} vs {opportunity.events?.away_team}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-[#2c2e33] rounded-xl transition-colors focus:outline-none"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 md:p-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-6">
            <div>
              <div className="flex items-center gap-3 text-sm font-medium text-[#8b8d93]">
                <span className="bg-[#222] px-3 py-1 rounded-lg text-white">{opportunity.events?.league_title || 'Unknown League'}</span>
                <span>•</span>
                <span className="text-[#39FF14] uppercase tracking-wider font-bold">{opportunity.market_key}</span>
              </div>
            </div>
            <div className="bg-[#1a2e15] border border-[#2a4a22] px-8 py-4 rounded-2xl text-center shadow-sm w-full md:w-auto">
              <div className="text-xs text-[#39FF14] uppercase font-extrabold tracking-widest mb-1">Guaranteed ROI</div>
              <div className="text-4xl font-black text-white">{Number(opportunity.roi).toFixed(2)}%</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Configuration Panel */}
            <div className="bg-[#111] border border-[#2c2e33] rounded-2xl p-6 shadow-sm">
              <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                <div className="p-1.5 bg-[#222] rounded-lg">
                  <DollarSign className="w-5 h-5 text-[#39FF14]" />
                </div>
                Total Bankroll
              </h3>
              
              <div className="mb-8">
                <div className="relative shadow-sm rounded-xl">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">R$</span>
                  <input 
                    type="number" 
                    value={totalBank}
                    onChange={(e) => setTotalBank(Number(e.target.value))}
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-xl pl-12 pr-4 py-3.5 text-white font-black text-xl focus:outline-none focus:ring-2 focus:ring-[#39FF14] focus:border-transparent transition-all"
                  />
                </div>
              </div>

              <div className="p-5 bg-[#1a1a1a] rounded-xl border border-[#333]">
                <div className="text-sm font-bold text-gray-400 mb-1">Estimated Net Profit</div>
                <div className="text-3xl font-black text-[#39FF14]">R$ {guaranteedProfit.toFixed(2)}</div>
              </div>
            </div>

            {/* Stake Distribution */}
            <div className="lg:col-span-2 space-y-5">
              {[leg1, leg2].map((leg, idx) => {
                const stake = idx === 0 ? stake1 : stake2;
                const ret = idx === 0 ? return1 : return2;
                
                return (
                  <div key={leg.id} className="bg-[#111] border border-[#2c2e33] rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between shadow-sm gap-6 md:gap-0">
                    <div className="flex-1 text-center md:text-left">
                      <div className="text-xs text-gray-500 uppercase tracking-widest mb-1.5 font-extrabold">{leg.bookmaker}</div>
                      <div className="text-xl font-bold text-white">{leg.outcome_name}</div>
                    </div>
                    
                    <div className="flex-1 text-center md:border-x border-[#333] px-4">
                      <div className="text-xs text-gray-500 font-bold mb-1 uppercase tracking-wider">Fixed Odds</div>
                      <div className="text-3xl font-black text-[#39FF14]">{Number(leg.price).toFixed(2)}</div>
                    </div>

                    <div className="flex-1 text-center md:text-right">
                      <div className="text-xs text-gray-500 font-bold mb-1 uppercase tracking-wider">Stake Exactly</div>
                      <div className="text-2xl font-black text-white">R$ {stake.toFixed(2)}</div>
                      <div className="text-sm font-bold text-emerald-400 mt-1">Return: R$ {ret.toFixed(2)}</div>
                    </div>
                  </div>
                );
              })}

              <div className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-5 flex gap-4 mt-6 items-start">
                <AlertCircle className="w-6 h-6 text-yellow-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-300 leading-relaxed">
                  <strong>Professional Tip:</strong> Round your stake amounts to avoid betting-site restrictions. Unusual amounts such as R$ 48.83 may attract automated monitoring.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
