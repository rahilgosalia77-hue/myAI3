'use client';

type Props = {
  onAction: (text: string) => void;
};

export default function QuickSidebar({ onAction }: Props) {
  return (
    <aside className="w-28 bg-gray-50 border-r border-gray-200 p-4 flex flex-col items-center gap-6 fixed left-0 top-0 h-screen pt-28 z-40">
      <h2 className="text-xs font-semibold uppercase text-gray-600 tracking-wide">
        Quick Actions
      </h2>

      {/* Button 1 */}
      <button
        className="quick-tile"
        onClick={() => onAction("Summarize the P&ID Overview Document.")}
      >
        <span className="quick-icon">📘</span>
        <span className="quick-label">P&ID</span>
      </button>

      {/* Button 2 */}
      <button
        className="quick-tile"
        onClick={() => onAction("Summarize the SOP Handbook Document.")}
      >
        <span className="quick-icon">🧰</span>
        <span className="quick-label">SOP</span>
      </button>

      {/* Button 3 */}
      <button
        className="quick-tile"
        onClick={() => onAction("Summarize the Incident Case Studies Document.")}
      >
        <span className="quick-icon">⚠️</span>
        <span className="quick-label">Incidents</span>
      </button>
    </aside>
  );
}
