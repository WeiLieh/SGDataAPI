import { useCallback, useMemo, useState } from "react";
import type { Region, RegionalReading } from "../../shared/datasets/regional";
import { loadRememberedRegion, rememberRegion, resolveRegion } from "../lib/regions";
import { formatSgtDate, formatSgtDateTime, staleHours } from "../lib/time";
import { useDataset } from "../lib/useDataset";
import { useLocateRegion } from "../lib/useLocateRegion";
import { RegionMap } from "./pm25/RegionMap";
import type { ScreenConfig } from "./screens";
import { TopBar, type ViewProps } from "./TopBar";

/**
 * The air-quality screen shared by PM2.5 and PSI (UI entries in Context.md): the selected region's
 * reading with its band, and the region map. The selected region is remembered on the phone and
 * shared by both tabs.
 */
export function AirQualityScreen({ config, onSwitch }: ViewProps & { config: ScreenConfig }) {
  const { state, refresh } = useDataset<{ regions: Region[]; readings: RegionalReading[] }>(config.dataset);
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
      <TopBar active={config.dataset} onSwitch={onSwitch} busy={busy} onRefresh={refresh} />

      <main className={busy && (state.response || state.error) ? "content dimmed" : "content"} aria-busy={busy}>
        <h2 className="section-title">{config.title}</h2>
        <section className="card air">
          {state.error ? (
            <ErrorState
              name={config.name}
              httpStatus={state.error.httpStatus}
              message={state.error.message}
              onRetry={refresh}
            />
          ) : !data || !latest ? (
            <p className="placeholder">Loading {config.name} readings…</p>
          ) : (
            <AirQuality
              regionName={regions.find((r) => r.id === selectedId)?.name ?? ""}
              value={selectedId ? (latest.values[selectedId] ?? null) : null}
              unit={config.unit}
              band={config.band}
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
                unit={config.unit}
                band={config.band}
              />
              <div className="map-footer">
                <Legend items={config.legend} unit={config.unit} />
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
          Contains information from {config.creditName} accessed on {formatSgtDate(state.response.fetchedAt)} from data.gov.sg
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
  unit: string | null;
  band: ScreenConfig["band"];
  timestamp: string;
  updatedTimestamp: string;
}) {
  const band = props.band(props.value);
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
            {props.unit && <span className="unit">{props.unit}</span>}
          </p>
          {band && <span className={`pill tone-${band.tone}`}>{band.label}</span>}
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

function ErrorState(props: { name: string; httpStatus: number | null; message: string; onRetry: () => void }) {
  return (
    <div className="error" role="alert">
      <p className="error-title">Couldn't load {props.name} readings</p>
      <p className="error-message">{props.message}</p>
      {props.httpStatus !== null && <p className="error-status">HTTP {props.httpStatus}</p>}
      <button type="button" className="retry" onClick={props.onRetry}>
        Retry
      </button>
    </div>
  );
}

function Legend({ items, unit }: { items: ScreenConfig["legend"]; unit: string | null }) {
  return (
    <ul className="legend" aria-label={unit ? `Colour legend in ${unit}` : "Colour legend"}>
      {items.map(({ tone, label }) => (
        <li key={label}>
          <span className={`swatch tone-${tone}`} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}
