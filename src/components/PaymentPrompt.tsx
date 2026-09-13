import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, CreditCard, Loader2, XCircle } from 'lucide-react';
import { getAuthToken, useAuth } from '../contexts/AuthContext';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
type Plan = 'weekly' | 'monthly' | 'annual';
interface PaymentPlan { name: string; amountUgx: number; durationDays: number; }
interface Subscription { status: string; plan: Plan; trialEndsAt: string; requestedAt: string | null; expiresAt: string | null; }
interface PaymentInfo { plans: Record<Plan, PaymentPlan>; number: string; name: string; }
const formatUgx = (amount: number) => `UGX ${amount.toLocaleString()}`;

export function PaymentPrompt() {
  const { user, refreshSession } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [plan, setPlan] = useState<Plan>('monthly');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const token = getAuthToken();
    if (!token) { setLoading(false); return; }
    try {
      const response = await fetch(`${API_BASE_URL}/api/subscription`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load subscription status.');
      setSubscription(data.subscription || null);
      setPayment(data.payment || null);
      if (data.subscription?.plan) setPlan(data.subscription.plan);
      setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load subscription status.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (user) void load(); else setLoading(false); }, [user]);
  useEffect(() => { if (!user) return; const timer = window.setInterval(() => { void load(); }, 60000); return () => window.clearInterval(timer); }, [user]);

  const submitPaymentRequest = async () => {
    const token = getAuthToken();
    if (!token) return;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/subscription/request-payment`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to submit payment request.');
      setSubscription(data.subscription || null); setPayment(data.payment || payment); await refreshSession();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to submit payment request.'); }
    finally { setSubmitting(false); }
  };

  if (!user || loading || !subscription || subscription.status === 'trial' || subscription.status === 'active' || subscription.status === 'permanent_active') return null;

  if (subscription.status === 'pending') return <div className="mx-5 mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 md:mx-10"><div className="flex items-start gap-3"><Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" /><div><h2 className="font-bold text-white">Payment request pending</h2><p className="mt-1 text-sm leading-6 text-gray-300">Your {payment?.plans?.[subscription.plan]?.name || subscription.plan} subscription request has been sent to the administrator. Access will activate as soon as the payment is confirmed.</p></div></div></div>;

  if (subscription.status === 'banned') return <div className="mx-5 mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-5 md:mx-10"><div className="flex items-start gap-3"><XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" /><div><h2 className="font-bold text-white">Subscription unavailable</h2><p className="mt-1 text-sm text-gray-300">Your subscription is currently unavailable. Please contact the administrator.</p></div></div></div>;

  const selected = payment?.plans?.[plan];
  return <div className="mx-5 mt-5 rounded-2xl border border-[#39FF14]/30 bg-[#39FF14]/5 p-5 md:mx-10"><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between"><div className="max-w-2xl"><div className="flex items-center gap-3"><CreditCard className="h-6 w-6 text-[#39FF14]" /><h2 className="text-xl font-extrabold">Your free trial has ended</h2></div><p className="mt-2 text-sm leading-6 text-gray-300">Continue with Pro by sending payment to <strong className="text-white">{payment?.name || 'the payment account'}</strong> at <strong className="text-white">{payment?.number || 'the configured payment number'}</strong>, then submit the request below for approval.</p></div><div className="flex w-full flex-col gap-3 lg:max-w-sm"><select value={plan} onChange={event => setPlan(event.target.value as Plan)} className="w-full rounded-xl border border-[#333] bg-[#161618] px-4 py-3 text-sm font-semibold text-white focus:border-[#39FF14] focus:outline-none">{(['weekly', 'monthly', 'annual'] as Plan[]).map(option => { const item = payment?.plans?.[option]; return <option key={option} value={option}>{item ? `${item.name} • ${formatUgx(item.amountUgx)} • ${item.durationDays} days` : option}</option>; })}</select><button onClick={() => void submitPaymentRequest()} disabled={submitting || !selected} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#39FF14] px-5 py-3 text-sm font-extrabold text-black disabled:opacity-50">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{submitting ? 'Submitting...' : "I've paid, submit for approval"}</button></div></div>{error && <p className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}</div>;
}
