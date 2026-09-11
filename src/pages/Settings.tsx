import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Activity, Target, Loader2, Save, CheckCircle2, Calculator, AlertTriangle, Building2, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';

const Toggle = ({ enabled, onChange, label }: { enabled: boolean; onChange: () => void; label?: string }) => (
  <button
    type="button"
    onClick={onChange}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
      enabled ? 'bg-indigo-600' : 'bg-slate-300'
    }`}
    role="switch"
    aria-checked={enabled}
    aria-label={label}
  >
    <span
      aria-hidden="true"
      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
        enabled ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

const estimatedLeaguesPerSport: Record<string, number> = {
  soccer: 40,
  basketball: 15,
  tennis: 20,
  'american football': 5,
  'ice hockey': 10,
  'mixed martial arts': 5,
  volleyball: 10,
  baseball: 5,
};

export function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [sports, setSports] = useState<any[]>([]);
  const [markets, setMarkets] = useState<any[]>([]);
  const [bookmakers, setBookmakers] = useState<any[]>([]);
  const [globalSettings, setGlobalSettings] = useState({
    id: 1,
    min_roi: 1.0,
    deep_scan: true,
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [{ data: sportsData }, { data: marketsData }, { data: bookmakersData }, { data: settingsData }] = await Promise.all([
        supabase.from('sports').select('*').order('title'),
        supabase.from('markets').select('*').order('title'),
        supabase.from('bookmakers').select('*').order('title'),
        supabase.from('system_settings').select('*').eq('id', 1).single(),
      ]);

      if (sportsData) setSports(sportsData);
      if (marketsData) setMarkets(marketsData);
      if (bookmakersData) setBookmakers(bookmakersData);
      if (settingsData) setGlobalSettings(settingsData);
    } catch (error) {
      console.error('Error loading scanner settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSport = async (key: string, currentStatus: boolean) => {
    setSports(sports.map(s => s.key === key ? { ...s, active: !currentStatus } : s));
    await supabase.from('sports').update({ active: !currentStatus }).eq('key', key);
  };

  const toggleMarket = async (key: string, currentStatus: boolean) => {
    setMarkets(markets.map(m => m.key === key ? { ...m, active: !currentStatus } : m));
    await supabase.from('markets').update({ active: !currentStatus }).eq('key', key);
  };

  const toggleBookmaker = async (key: string, currentStatus: boolean) => {
    setBookmakers(bookmakers.map(b => b.key === key ? { ...b, active: !currentStatus } : b));
    await supabase.from('bookmakers').update({ active: !currentStatus }).eq('key', key);
  };

  const handleSaveGlobals = async () => {
    setSaving(true);
    try {
      await supabase.from('system_settings').update({
        min_roi: globalSettings.min_roi,
        deep_scan: globalSettings.deep_scan,
      }).eq('id', 1);
      setSaveMessage('Preferences saved successfully.');
      setTimeout(() => setSaveMessage(''), 4000);
    } catch (error) {
      console.error('Error saving scanner preferences:', error);
    } finally {
      setSaving(false);
    }
  };

  const activeSportsKeys = sports.filter(s => s.active).map(s => s.key);
  const estimatedLeaguesCount = activeSportsKeys.reduce((total, key) => total + (estimatedLeaguesPerSport[key] || 5), 0);
  const estimatedRequestsPerCycle = 1 + estimatedLeaguesCount;
  const isOverLimit = estimatedRequestsPerCycle > 100;

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 w-full max-w-7xl mx-auto pb-24">
      <div className="flex items-center gap-4 mb-2">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center border border-indigo-100 shadow-sm">
          <SettingsIcon className="w-6 h-6 text-indigo-600" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Scanner Settings</h1>
      </div>
      <p className="text-slate-500 text-sm font-medium mb-10 ml-16">
        Configure which sports, markets, bookmakers, and minimum ROI the automated engine uses.
      </p>

      <div className="mb-8 bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-600 flex-shrink-0" />
        <div>
          <p className="font-bold text-emerald-900">Automatic scanning is always enabled.</p>
          <p className="text-sm text-emerald-800 mt-1">New matches are generated every 12 hours. Matches currently in progress are refreshed automatically every 2 minutes.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-8">
          <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
              <Building2 className="w-5 h-5 text-indigo-600" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">Bookmakers</h2>
                <p className="text-sm text-slate-500 font-medium">Choose which bookmakers the engine compares. At least two are required.</p>
              </div>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {bookmakers.length === 0 ? (
                <div className="col-span-full p-4 text-center text-slate-500 text-sm">No bookmakers found. Run the database migration.</div>
              ) : (
                bookmakers.map(bookie => (
                  <div key={bookie.key} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-200 hover:shadow-sm transition-all">
                    <span className="text-sm font-bold text-slate-900">{bookie.title}</span>
                    <Toggle enabled={bookie.active} onChange={() => toggleBookmaker(bookie.key, bookie.active)} />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
              <Activity className="w-5 h-5 text-indigo-600" />
              <div className="flex-1">
                <h2 className="text-lg font-bold text-slate-900">Sports</h2>
                <p className="text-sm text-slate-500 font-medium">Enable the sports whose worldwide leagues should be included automatically.</p>
              </div>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {sports.map(sport => (
                <div key={sport.key} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-200 hover:shadow-sm transition-all">
                  <span className="text-sm font-bold text-slate-900">{sport.title}</span>
                  <Toggle enabled={sport.active} onChange={() => toggleSport(sport.key, sport.active)} />
                </div>
              ))}
            </div>
            <div className="px-6 pb-6">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex gap-3 items-start text-indigo-900 text-sm font-medium">
                <Info className="w-5 h-5 flex-shrink-0 text-indigo-600 mt-0.5" />
                <p><strong>Automatic discovery:</strong> enabling a sport makes the engine discover its available leagues and upcoming matches during each 12-hour generation cycle.</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
              <Target className="w-5 h-5 text-indigo-600" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">Markets</h2>
                <p className="text-sm text-slate-500 font-medium">Choose which betting markets the engine compares.</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {markets.map(market => (
                <div key={market.key} className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-200 hover:shadow-sm transition-all">
                  <div>
                    <div className="text-sm font-bold text-slate-900 mb-1">{market.title}</div>
                    <div className="text-xs text-slate-500 font-medium">{market.description}</div>
                  </div>
                  <Toggle enabled={market.active} onChange={() => toggleMarket(market.key, market.active)} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className={`border shadow-sm rounded-2xl overflow-hidden ${isOverLimit ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
            <div className={`p-6 border-b flex items-center gap-3 ${isOverLimit ? 'border-red-100 bg-red-100/50' : 'border-slate-100 bg-slate-50/50'}`}>
              <Calculator className={`w-5 h-5 ${isOverLimit ? 'text-red-600' : 'text-indigo-600'}`} />
              <div>
                <h2 className={`text-lg font-bold ${isOverLimit ? 'text-red-900' : 'text-slate-900'}`}>API Usage Estimate</h2>
                <p className={`text-sm font-medium ${isOverLimit ? 'text-red-700' : 'text-slate-500'}`}>Estimated requests for one full generation cycle.</p>
              </div>
            </div>
            <div className="p-6">
              <div className="flex justify-between items-end mb-5">
                <div>
                  <div className={`text-5xl font-black tracking-tight ${isOverLimit ? 'text-red-600' : 'text-slate-900'}`}>~{estimatedRequestsPerCycle}</div>
                  <div className={`text-sm font-bold uppercase tracking-wider mt-1 ${isOverLimit ? 'text-red-500' : 'text-slate-400'}`}>requests / cycle</div>
                </div>
                <div className="text-right">
                  <div className={`text-base font-extrabold ${isOverLimit ? 'text-red-800' : 'text-slate-700'}`}>~{estimatedLeaguesCount} leagues</div>
                  <div className={`text-sm font-medium ${isOverLimit ? 'text-red-600' : 'text-slate-500'}`}>one cycle every 12 hours</div>
                </div>
              </div>

              {isOverLimit ? (
                <div className="flex gap-3 text-sm text-red-800 bg-red-100 p-4 rounded-xl border border-red-200 font-medium">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-600" />
                  <p><strong>Notice:</strong> This full cycle may exceed a 100-request hourly limit. The 12-hour schedule itself keeps the average request rate low.</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500 font-medium text-center bg-slate-50 p-3 rounded-lg border border-slate-100">The automatic 12-hour schedule is enabled by the backend.</p>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden sticky top-8">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3 bg-slate-50/50">
              <SettingsIcon className="w-5 h-5 text-indigo-600" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">Scanner Rules</h2>
                <p className="text-sm text-slate-500 font-medium">Only analysis preferences can be changed here.</p>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Minimum ROI for a surebet</label>
                <div className="relative shadow-sm rounded-xl">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={globalSettings.min_roi}
                    onChange={e => setGlobalSettings({ ...globalSettings, min_roi: Number(e.target.value) })}
                    className="w-full bg-white border border-slate-300 rounded-xl pl-4 pr-12 py-3 text-slate-900 font-bold text-base focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">%</span>
                </div>
              </div>

              <button
                onClick={handleSaveGlobals}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                {saving ? 'Saving...' : 'Save Preferences'}
              </button>

              {saveMessage && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex gap-2 items-center justify-center text-emerald-700 text-sm font-bold">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  {saveMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
