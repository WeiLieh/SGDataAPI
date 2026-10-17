import { useCallback, useMemo, useState } from "react";
import type { Pm25Data } from "../../shared/datasets/pm25";
import { pm25Band } from "../../shared/datasets/pm25-bands";
import { bandTone } from "../lib/colors";
import { loadRememberedRegion, rememberRegion, resolveRegion } from "../lib/regions";
import { formatSgtDate, formatSgtDateTime, staleHours } from "../lib/time";
import { useDataset } from "../lib/useDataset";
import { useLocateRegion } from "../lib/useLocateRegion";
import { RegionMap } from "./pm25/RegionMap";
import { TopBar, type ViewProps } from "./TopBar";

/** PM2.5 screen, built from the UI entries of 2026-10-16 in Context.md. */
export function Pm25View({ onSwitch }: ViewProps) {
  const { state, refresh } = useDataset<Pm25Data>("pm25");
  const [chosen, setChosen] = useState<string | null>(() => loadRememberedRegion());

  const choose = useCallback((id: string) => {
    setChosen(id);
    rememberRegion(id);
  }, []);

  const data = state.response?.data ?? null;
  const regions = useMemo(() => data?.regions ?? [], [data]);
  const { status: locateStatus, locate } = useLocateRegion(regions, choose);
  const selectedId = resolveRegion(chosen, regions);
  const latest = data?.readings.at(-1) ?? null;
  const busy = state.loading;

  return (
    <div className="app">
      <TopBar active="pm25" onSwitch={onSwitch} busy={busy} onRefresh={refresh} />

      <main className={busy && (state.response || state.error) ? "content dimmed" : "content"} aria-busy={busy}>
        <h2 className="section-title">Air Quality</h2>
        <section className="card air">
          {state.error ? (
            <ErrorState httpStatus={state.error.httpStatus} message={state.error.message} onRetry={refresh} />
          ) : !data || !latest ? (
            <p className="placeholder">Loading PM2.5 readings…</p>
          ) : (
            <AirQuality
              regionName={regions.find((r) => r.id === selectedId)?.name ?? ""}
              value={selectedId ? (latest.values[selectedId] ?? null) : null}
              unit={data.unit}
              timestamp={latest.timestamp}
              updatedTimestamp={latest.updatedTimestamp}
            />
          )}
        </section>

        <h2 className="section-title">Region</h2>
        <section className="card regions">
          {data && latest && !state.error ? (
            <>
              <p className="hint">Tap any region to focus</p>
              <RegionMap
                regions={regions}
                values={latest.values}
                selected={selectedId}
                onSelect={choose}
                unit={data.unit}
              />
              <div className="map-footer">
                <Legend />
              </div>
              <button
                type="button"
                className="locate"
                onClick={locate}
                disabled={locateStatus === "locating"}
              >
                {locateStatus === "locating" ? "Loading position…" : "Use my location"}
              </button>
              {locateStatus === "fallback" && (
                <p className="locate-note">Location unavailable, showing Central.</p>
              )}
            </>
          ) : (
            <p className="placeholder">{state.error ? "No readings to show." : "Loading map…"}</p>
          )}
        </section>
      </main>

      {state.response && (
        <footer className="credit">
          Contains information from PM2.5 accessed on {formatSgtDate(state.response.fetchedAt)} from data.gov.sg
          which is made available under the terms of the{" "}
          <a href="https://data.gov.sg/open-data-licence">Singapore Open Data Licence version 1.0</a>
        </footer>
      )}
    </div>
  );
}

function AirQuality(props: {
  regionName: string;
  value: number | null;
  unit: string;
  timestamp: string;
  updatedTimestamp: string;
}) {
  const band = pm25Band(props.value);
  const stale = staleHours(props.timestamp, new Date());
  const staleTag = stale === null ? "" : `[Stale for ${stale} hrs] `;
  return (
    <div className="air-body">
      <p className="region-name">{props.regionName}</p>
      {props.value === null ? (
        <>
          <p className="reading">
            <span className="number">—</span>
          </p>
          <p className="no-reading">No reading</p>
        </>
      ) : (
        <>
          <p className="reading">
            <span className="number">{props.value}</span>
            <span className="unit">{props.unit}</span>
          </p>
          {band && <span className={`pill tone-${bandTone(band)}`}>{band.label}</span>}
          {band && <p className="advice">{band.recommendation}</p>}
        </>
      )}
      <div className="times">
        <p>
          {staleTag}Reading for {formatSgtDateTime(props.timestamp)}
        </p>
        <p>
          {staleTag}Published at {formatSgtDateTime(props.updatedTimestamp)}
        </p>
      </div>
    </div>
  );
}

function ErrorState(props: { httpStatus: number | null; message: string; onRetry: () => void }) {
  return (
    <div className="error" role="alert">
      <p className="error-title">Couldn't load PM2.5 readings</p>
      <p className="error-message">{props.message}</p>
      {props.httpStatus !== null && <p className="error-status">HTTP {props.httpStatus}</p>}
      <button type="button" className="retry" onClick={props.onRetry}>
        Retry
      </button>
    </div>
  );
}

function Legend() {
  const items: Array<[string, string]> = [
    ["green", "0–55"],
    ["yellow", "56–150"],
    ["orange", "151–250"],
    ["red", "≥251"],
  ];
  return (
    <ul className="legend" aria-label="Colour legend in µg/m³">
      {items.map(([tone, label]) => (
        <li key={label}>
          <span className={`swatch tone-${tone}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
