import React, { useState } from 'react';
import { Calculator as CalcIcon, Plus, Trash2, DollarSign } from 'lucide-react';

interface Outcome {
  id: string;
  name: string;
  odd: string;
}

export function Calculator() {
  const [totalBank, setTotalBank] = useState<string>('1000');
  const [outcomes, setOutcomes] = useState<Outcome[]>([
    { id: '1', name: 'Outcome 1', odd: '2.10' },
    { id: '2', name: 'Outcome 2', odd: '2.05' }
  ]);

  const addOutcome = () => {
    if (outcomes.length >= 3) return; // Limit to 3 outcomes (1X2)
    setOutcomes([...outcomes, { id: Date.now().toString(), name: `Outcome ${outcomes.length + 1}`, odd: '' }]);
  };

  const removeOutcome = (id: string) => {
    if (outcomes.length <= 2) return;
    setOutcomes(outcomes.filter(o => o.id !== id));
  };

  const updateOutcome = (id: string, field: 'name' | 'odd', value: string) => {
    setOutcomes(outcomes.map(o => o.id === id ? { ...o, [field]: value } : o));
  };

  const bank = parseFloat(totalBank) || 0;
  let totalImpliedProb = 0;
  let isValid = true;

  const parsedOutcomes = outcomes.map(o => {
    const odd = parseFloat(o.odd);
    if (isNaN(odd) || odd <= 1) {
      isValid = false;
      return { ...o, prob: 0, stake: 0, return: 0 };
    }
    const prob = 1 / odd;
    totalImpliedProb += prob;
    return { ...o, numOdd: odd, prob };
  });

  const isSurebet = isValid && totalImpliedProb < 1 && totalImpliedProb > 0;
  const roi = isSurebet ? ((1 / totalImpliedProb) - 1) * 100 : 0;
  const guaranteedProfit = isSurebet ? (bank * (roi / 100)) : 0;

  const calculatedOutcomes = parsedOutcomes.map(o => {
    if (!isSurebet) return { ...o, stake: 0, return: 0 };
    const stake = (o.prob / totalImpliedProb) * bank;
    return { ...o, stake, return: stake * o.numOdd };
  });

  return (
    <div className="p-6 md:p-10 w-full max-w-5xl mx-auto pb-24">
      <div className="flex items-center gap-4 mb-2">
        <div className="w-12 h-12 rounded-xl bg-[#39FF14]/10 flex items-center justify-center border border-[#39FF14]/20 shadow-sm">
          <CalcIcon className="w-6 h-6 text-[#39FF14]" />
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Manual Calculator</h1>
      </div>
      <p className="text-[#8b8d93] text-sm font-medium mb-10 ml-16">
        Enter odds manually to determine whether an arbitrage opportunity exists.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-6 shadow-lg h-fit">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#39FF14]" />
            Total Bankroll
          </h2>
          
          <div className="relative shadow-sm rounded-xl mb-8">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-bold">R$</span>
            <input 
              type="number" 
              value={totalBank}
              onChange={(e) => setTotalBank(e.target.value)}
              className="w-full bg-[#111] border border-[#333] rounded-xl pl-12 pr-4 py-3.5 text-white font-black text-xl focus:outline-none focus:ring-2 focus:ring-[#39FF14] transition-all"
            />
          </div>

          <div className={`p-5 rounded-xl border ${isSurebet ? 'bg-[#1a2e15] border-[#2a4a22]' : 'bg-[#1a1a1a] border-[#333]'}`}>
            <div className="text-sm font-bold text-gray-400 mb-1">Operation Status</div>
            {isSurebet ? (
              <>
                <div className="text-3xl font-black text-[#39FF14] mb-2">SUREBET!</div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">ROI:</span>
                  <span className="font-bold text-[#39FF14]">{roi.toFixed(2)}%</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-gray-400">Profit:</span>
                  <span className="font-bold text-[#39FF14]">R$ {guaranteedProfit.toFixed(2)}</span>
                </div>
              </>
            ) : (
              <div className="text-xl font-bold text-red-500">Loss (Margin &gt; 100%)</div>
            )}
            <div className="mt-4 text-xs text-gray-500">
              Total Margin: {(totalImpliedProb * 100).toFixed(2)}%
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {calculatedOutcomes.map((outcome) => (
            <div key={outcome.id} className="bg-[#161618] border border-[#2c2e33] rounded-2xl p-6 flex flex-col md:flex-row items-center gap-4 shadow-lg relative group">
              {outcomes.length > 2 && (
                <button 
                  onClick={() => removeOutcome(outcome.id)}
                  className="absolute -right-3 -top-3 bg-red-500 hover:bg-red-600 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}

              <div className="flex-1 w-full">
                <label className="block text-xs text-gray-500 font-bold mb-1 uppercase">Outcome Name</label>
                <input 
                  type="text" 
                  value={outcome.name}
                  onChange={(e) => updateOutcome(outcome.id, 'name', e.target.value)}
                  className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#39FF14]"
                />
              </div>

              <div className="w-full md:w-32">
                <label className="block text-xs text-gray-500 font-bold mb-1 uppercase">Odds</label>
                <input 
                  type="number" 
                  step="0.01"
                  value={outcome.odd}
                  onChange={(e) => updateOutcome(outcome.id, 'odd', e.target.value)}
                  className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-[#39FF14] font-bold text-lg focus:outline-none focus:border-[#39FF14] text-center"
                />
              </div>

              <div className="w-full md:w-40 bg-[#111] rounded-lg p-3 border border-[#333] text-center">
                <div className="text-xs text-gray-500 font-bold mb-1 uppercase">Stake</div>
                <div className="text-xl font-black text-white">R$ {outcome.stake.toFixed(2)}</div>
              </div>
            </div>
          ))}

          {outcomes.length < 3 && (
            <button 
              onClick={addOutcome}
              className="w-full py-4 border-2 border-dashed border-[#333] rounded-2xl text-gray-400 hover:text-white hover:border-[#39FF14] hover:bg-[#39FF14]/5 transition-all flex items-center justify-center gap-2 font-bold"
            >
              <Plus className="w-5 h-5" /> Add 3rd Outcome (e.g. Draw)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
