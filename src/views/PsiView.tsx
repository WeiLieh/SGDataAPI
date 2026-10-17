import type { CSSProperties } from "react";
import { psiBand } from "../../shared/datasets/psi-bands";
import { PSI_COLOURS } from "../lib/colors";
import { psiHourRows } from "../lib/psiHistory";
import { formatSgtDate, formatSgtDateTime, staleHours } from "../lib/time";
import { usePsiHistory } from "../lib/usePsiHistory";
import { TopBar, type ViewProps } from "./TopBar";

/**
 * PSI screen, first pass: plain, unstyled HTML (owner's spec, 2026-10-17) under the shared tabs.
 * Only the 24-hour PSI, an index value with no unit: the latest hour plus the 11 before it.
 */
export function PsiView({ onSwitch }: ViewProps) {
  const { state, refresh } = usePsiHistory();
  const busy = state.loading;
  const data = state.data;
  const latest = data?.readings.at(-1) ?? null;

  return (
    <div className="app">
      <TopBar active="psi" onSwitch={onSwitch} busy={busy} onRefresh={refresh} />
      <main className={busy && (data || state.error) ? "content dimmed plain" : "content plain"} aria-busy={busy}>
        <h1>PSI (24-hour)</h1>
        {state.error ? (
          <div role="alert">
            <p>
              Couldn't load PSI readings: {state.error.message}
              {state.error.httpStatus !== null ? ` (HTTP ${state.error.httpStatus})` : ""}
            </p>
            <button type="button" onClick={refresh}>
              Retry
            </button>
          </div>
        ) : !data || !latest ? (
          <p>Loading PSI readings…</p>
        ) : (
          <>
            <Times timestamp={latest.timestamp} updatedTimestamp={latest.updatedTimestamp} />

            <h2>Latest</h2>
            <table border={1} cellPadding={4}>
              <thead>
                <tr>
                  <th>Region</th>
                  <th>PSI (24-hour)</th>
                  <th>Descriptor</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {data.regions.map((region) => {
                  const value = latest.values[region.id] ?? null;
                  const band = psiBand(value);
                  return (
                    <tr key={region.id}>
                      <th scope="row">{region.name}</th>
                      <PsiCell value={value} />
                      <td>{band ? band.label : "No reading"}</td>
                      <td>{band ? band.recommendation : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h2>Past 12 hours</h2>
            <table border={1} cellPadding={4}>
              <thead>
                <tr>
                  <th>Hour</th>
                  {data.regions.map((region) => (
                    <th key={region.id}>{region.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {psiHourRows(data.readings).map((row) => (
                  <tr key={row.timestamp}>
                    <th scope="row">{formatSgtDateTime(row.timestamp)}</th>
                    {data.regions.map((region) => (
                      <PsiCell key={region.id} value={row.reading ? (row.reading.values[region.id] ?? null) : null} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {state.fetchedAt && (
          <p>
            Contains information from Pollutant Standards Index (PSI) accessed on {formatSgtDate(state.fetchedAt)} from
            data.gov.sg which is made available under the terms of the{" "}
            <a href="https://data.gov.sg/open-data-licence">Singapore Open Data Licence version 1.0</a>
          </p>
        )}
      </main>
    </div>
  );
}

/** A PSI value shaded in its band colour with white text; no reading is never 0 and never coloured. */
function PsiCell({ value }: { value: number | null }) {
  const band = psiBand(value);
  if (value === null || !band) return <td>No reading</td>;
  const style: CSSProperties = { background: PSI_COLOURS[band.label], color: "#ffffff" };
  return (
    <td style={style} title={band.label}>
      {value}
    </td>
  );
}

function Times({ timestamp, updatedTimestamp }: { timestamp: string; updatedTimestamp: string }) {
  const stale = staleHours(timestamp, new Date());
  const tag = stale === null ? "" : `[Stale for ${stale} hrs] `;
  return (
    <>
      <p>
        {tag}Reading for {formatSgtDateTime(timestamp)}
      </p>
      <p>
        {tag}Published at {formatSgtDateTime(updatedTimestamp)}
      </p>
    </>
  );
}
