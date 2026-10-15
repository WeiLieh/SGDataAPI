import type { Pm25Data } from "../../shared/datasets/pm25";
import { formatSgtDate, formatSgtDateTime } from "../lib/time";
import { useDataset } from "../lib/useDataset";

/** Plain, unstyled PM2.5 screen: each region's latest 1-hour reading, until a UI entry says otherwise. */
export function Pm25View() {
  const { state, retry } = useDataset<Pm25Data>("pm25");

  if (state.status === "loading") return <p>Loading PM2.5 readings…</p>;

  if (state.status === "error") {
    return (
      <div>
        <p>
          Error{state.httpStatus !== null ? ` (HTTP ${state.httpStatus})` : ""}: {state.message}
        </p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }

  const { response } = state;
  const { data } = response;
  const latest = data.readings.at(-1);

  return (
    <div>
      <h1>PM2.5 (1-hour)</h1>
      {latest ? (
        <>
          <p>Reading for the hour of {formatSgtDateTime(latest.timestamp)}</p>
          <p>Published by data.gov.sg at {formatSgtDateTime(latest.updatedTimestamp)}</p>
          <ul>
            {data.regions.map((region) => {
              const value = latest.values[region.id] ?? null;
              return (
                <li key={region.id}>
                  {region.name}: {value === null ? "No reading" : `${value} ${data.unit}`}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p>No reading.</p>
      )}
      <p>
        Contains information from PM2.5 accessed on {formatSgtDate(response.fetchedAt)} from data.gov.sg
        which is made available under the terms of the{" "}
        <a href="https://data.gov.sg/open-data-licence">Singapore Open Data Licence version 1.0</a>
      </p>
    </div>
  );
}
