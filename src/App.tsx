import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { PaymentPrompt } from './components/PaymentPrompt';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { Dashboard } from './pages/Dashboard';
import { History } from './pages/History';
import { Admin } from './pages/Admin';
import { Auth } from './pages/Auth';
import { Settings } from './pages/Settings';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Loader2, Menu } from 'lucide-react';

function hasAdminRole(role: unknown): boolean {
  return String(role ?? '').trim().toUpperCase() === 'ADMIN';
}

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a]"><Loader2 className="h-8 w-8 animate-spin text-[#39FF14]" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a]"><Loader2 className="h-8 w-8 animate-spin text-[#39FF14]" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!hasAdminRole(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
};

function AppRoutes() {
  const { user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  if (!user) return <><PWAInstallPrompt /><Routes><Route path="/auth" element={<Auth />} /><Route path="*" element={<Navigate to="/auth" replace />} /></Routes></>;
  return <div className="flex h-screen min-h-0 overflow-hidden bg-[#0a0a0a] font-sans text-white selection:bg-[#39FF14]/30 selection:text-[#39FF14]">
    <Sidebar collapsed={sidebarCollapsed} mobileOpen={mobileMenuOpen} onToggleCollapsed={() => setSidebarCollapsed(value => !value)} onCloseMobile={() => setMobileMenuOpen(false)} />
    <main className="relative min-w-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-30 flex h-14 items-center border-b border-[#222] bg-[#0a0a0a]/95 px-4 backdrop-blur md:hidden"><button onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation" className="rounded-lg p-2 text-gray-300 hover:bg-[#1a1a1a] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#39FF14]"><Menu className="h-6 w-6" /></button><span className="ml-3 text-lg font-extrabold tracking-tight">Football<span className="text-[#39FF14]">AI</span></span></div>
      <PaymentPrompt />
      <PWAInstallPrompt />
      <Routes>
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
        <Route path="/admin" element={<AdminRoute><Admin /></AdminRoute>} />
        <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  </div>;
}

function App() { return <AuthProvider><Router><AppRoutes /></Router></AuthProvider>; }
export default App;
