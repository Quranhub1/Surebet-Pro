import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { History } from './pages/History';
import { Auth } from './pages/Auth';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Loader2, Menu } from 'lucide-react';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a]"><Loader2 className="h-8 w-8 animate-spin text-[#39FF14]" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  return <>{children}</>;
};

function AppRoutes() {
  const { user } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!user) return <Routes><Route path="/auth" element={<Auth />} /><Route path="*" element={<Navigate to="/auth" replace />} /></Routes>;

  return <div className="flex h-screen min-h-0 bg-[#0a0a0a] font-sans text-white overflow-hidden selection:bg-[#39FF14]/30 selection:text-[#39FF14]">
    <Sidebar collapsed={sidebarCollapsed} mobileOpen={mobileMenuOpen} onToggleCollapsed={() => setSidebarCollapsed(value => !value)} onCloseMobile={() => setMobileMenuOpen(false)} />
    <main className="relative min-w-0 flex-1 overflow-y-auto">
      <div className="sticky top-0 z-30 flex h-14 items-center border-b border-[#222] bg-[#0a0a0a]/95 px-4 backdrop-blur md:hidden">
        <button onClick={() => setMobileMenuOpen(true)} aria-label="Open navigation" className="rounded-lg p-2 text-gray-300 hover:bg-[#1a1a1a] hover:text-white focus:outline-none focus:ring-2 focus:ring-[#39FF14]"><Menu className="h-6 w-6" /></button>
        <span className="ml-3 text-lg font-extrabold tracking-tight">Surebet<span className="text-[#39FF14]">Pro</span></span>
      </div>
      <Routes>
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </main>
  </div>;
}

function App() { return <AuthProvider><Router><AppRoutes /></Router></AuthProvider>; }
export default App;
