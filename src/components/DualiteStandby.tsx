import React from 'react';
import { Play, RotateCw, Lock, Maximize } from 'lucide-react';

/**
 * Requested component:
 * A faithful reproduction of the Dualite standby screen.
 * Note: This component is not part of the SurebetPro application and is retained only for design reference.
 */
export function DualiteStandby() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col font-sans selection:bg-gray-700">
      {/* Top Bar (Browser Mockup) */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#222] bg-[#111]">
        <div className="flex bg-[#1a1a1a] rounded-md p-1 border border-[#222]">
          <button className="px-3 py-1 text-sm bg-[#2a2a2a] text-white rounded shadow-sm font-medium">Preview</button>
          <button className="px-3 py-1 text-sm text-gray-400 hover:text-white transition-colors">Code</button>
        </div>

        <div className="flex-1 max-w-xl mx-4">
          <div className="flex items-center bg-[#1a1a1a] rounded-md px-3 py-1.5 border border-[#333]">
            <RotateCw className="w-4 h-4 text-gray-500 mr-2" />
            <div className="w-px h-4 bg-gray-700 mx-2"></div>
            <span className="text-gray-500 text-sm font-mono">/</span>
            <div className="flex gap-1.5 ml-auto">
              <div className="w-3.5 h-3.5 border border-gray-500 rounded-sm"></div>
              <div className="w-3.5 h-3.5 border border-gray-500 rounded-sm"></div>
              <div className="w-3.5 h-3.5 border border-gray-500 rounded-sm"></div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-300 bg-[#1a1a1a] border border-[#333] rounded-md hover:bg-[#2a2a2a] transition-colors">
            <RotateCw className="w-4 h-4" /> Restart
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-300 bg-[#1a1a1a] border border-[#333] rounded-md hover:bg-[#2a2a2a] transition-colors">
            <Lock className="w-4 h-4" /> Variables
          </button>
          <button className="p-1.5 text-gray-300 bg-[#1a1a1a] border border-[#333] rounded-md hover:bg-[#2a2a2a] transition-colors">
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center">
        <h1 className="text-[22px] font-medium mb-6 text-white tracking-tight">
          Talk to Dualite to start building your app.
        </h1>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 px-6 py-2.5 bg-white text-black font-semibold rounded-md hover:bg-gray-200 transition-colors"
        >
          <Play className="w-4 h-4 fill-current" /> Run Preview
        </button>
      </div>

      <div className="p-6 flex justify-center">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-300">
          <div className="w-2 h-2 rounded-full bg-[#34d399] shadow-[0_0_8px_rgba(52,211,153,0.5)]"></div>
          Ready
        </div>
      </div>
    </div>
  );
}
