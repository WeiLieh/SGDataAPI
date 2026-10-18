import type { DatasetId } from "../../shared/datasets/registry";

export interface ViewProps {
  /** Switches the screen; the app always opens on PM2.5 and does not remember the tab. */
  onSwitch: (id: DatasetId) => void;
}

const TABS: Array<{ id: DatasetId; label: string }> = [
  { id: "pm25", label: "PM2.5" },
  { id: "psi", label: "PSI" },
];

/** The PM2.5 | PSI tabs and the refresh button, shared by both screens. */
export function TopBar(props: { active: DatasetId; onSwitch: (id: DatasetId) => void; busy: boolean; onRefresh: () => void }) {
  return (
    <header className="top">
      <div className="toggle" role="tablist" aria-label="Measure">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={tab.id === props.active ? "segment active" : "segment"}
            aria-selected={tab.id === props.active}
            onClick={() => props.onSwitch(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={props.busy ? "refresh spinning" : "refresh"}
        onClick={props.onRefresh}
        aria-label="Refresh"
        aria-busy={props.busy}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M20 11a8 8 0 0 0-14.3-4.9M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9M20 20v-4h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </header>
  );
}
