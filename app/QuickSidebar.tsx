"use client";

import React from "react";

export default function QuickSidebar() {
  return (
    <aside className="w-28 bg-gray-50 border-r border-gray-200 p-4 flex flex-col items-center gap-6 fixed left-0 top-0 h-screen pt-28 z-40">
      <h2 className="text-xs font-semibold uppercase text-gray-600 tracking-wide ">
      </h2>

      {/* Quick Tools */}
      <div className="text-xs font-semibold text-gray-500 tracking-wide text-center px-2 underline decoration-gray-400 underline-offset-4">
        QUICK <br /> TOOLS
      </div>

      {/* Steam Tables */}
      <a
        href="https://pages.mtu.edu/~tbco/cm3230/steamtables.pdf"  // ⬅️ your link here
        target="_blank"
        rel="noopener noreferrer"
        className="quick-tile"
        title="Steam Tables"
        aria-label="Steam Tables"
      >
        <span className="quick-icon" aria-hidden>💧</span>
        <span className="quick-label">Steam Handbook </span>
      </a>

      {/* ChemEng Toolbox */}
      <a
        href="https://www.engineeringtoolbox.com/" // ⬅️ your link here
        target="_blank"
        rel="noopener noreferrer"
        className="quick-tile"
        title="ChemEng Toolbox"
        aria-label="ChemEng Toolbox"
      >
        <span className="quick-icon" aria-hidden>🧰</span>
        <span className="quick-label">Toolbox</span>
      </a>

      {/* Materials Safety */}
      <a
        href="https://pubchem.ncbi.nlm.nih.gov/" // ⬅️ your link here
        target="_blank"
        rel="noopener noreferrer"
        className="quick-tile"
        title="Material Safety Data"
        aria-label="Material Safety"
      >
        <span className="quick-icon" aria-hidden>⚠️</span>
        <span className="quick-label">Material Safety</span>
      </a>
    </aside>
  );
}
