import type { KeyboardEvent } from "react";
import type { Pm25Region } from "../../../shared/datasets/pm25";
import { pm25Band } from "../../../shared/datasets/pm25-bands";
import { bandTone } from "../../lib/colors";

/**
 * Stylised outline of Singapore island as [longitude, latitude] points (owner approved a
 * stylised shape, not an accurate coastline). Decoration only: no reading comes from here.
 */
const ISLAND: Array<[number, number]> = [
  [103.605, 1.335], [103.625, 1.365], [103.655, 1.395], [103.69, 1.425], [103.73, 1.445],
  [103.77, 1.452], [103.81, 1.468], [103.84, 1.455], [103.87, 1.432], [103.905, 1.42],
  [103.945, 1.41], [103.985, 1.392], [104.025, 1.375], [104.045, 1.35], [104.03, 1.325],
  [103.99, 1.318], [103.955, 1.305], [103.915, 1.292], [103.88, 1.275], [103.855, 1.252],
  [103.82, 1.236], [103.785, 1.25], [103.755, 1.275], [103.72, 1.292], [103.685, 1.3],
  [103.65, 1.298], [103.62, 1.31],
];

const VIEW_W = 360;
const VIEW_H = 275;

/** Equal-ish scale east-west, stretched 1.5× north-south so the five circles have room. */
function project(longitude: number, latitude: number): { x: number; y: number } {
  return { x: 10 + (longitude - 103.59) * 720, y: 10 + (1.475 - latitude) * 1080 };
}

function islandPath(): string {
  const points = ISLAND.map(([lon, lat]) => project(lon, lat));
  // Smooth the outline with quadratic curves through midpoints.
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const n = points.length;
  const start = mid(points[n - 1]!, points[0]!);
  let d = `M${start.x.toFixed(1)},${start.y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    const m = mid(p, points[(i + 1) % n]!);
    d += ` Q${p.x.toFixed(1)},${p.y.toFixed(1)} ${m.x.toFixed(1)},${m.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

const ISLAND_PATH = islandPath();

interface Props {
  regions: Pm25Region[];
  values: Record<string, number | null>;
  selected: string | null;
  onSelect: (id: string) => void;
  unit: string;
}

export function RegionMap({ regions, values, selected, onSelect, unit }: Props) {
  const placed = regions.filter((r) => r.latitude !== null && r.longitude !== null);
  const unplaced = regions.filter((r) => r.latitude === null || r.longitude === null);

  const describe = (region: Pm25Region) => {
    const value = values[region.id] ?? null;
    const band = pm25Band(value);
    return value === null ? `${region.name}: no reading` : `${region.name}: ${value} ${unit}, ${band?.label ?? ""}`;
  };

  const onKey = (event: KeyboardEvent, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className="region-map">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="group" aria-label="Singapore regions">
        <path className="island" d={ISLAND_PATH} />
        {placed.map((region) => {
          const { x, y } = project(region.longitude!, region.latitude!);
          const value = values[region.id] ?? null;
          const tone = bandTone(pm25Band(value));
          const isSelected = region.id === selected;
          return (
            <g
              key={region.id}
              className={`region tone-${tone}${isSelected ? " selected" : ""}`}
              transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={describe(region)}
              onClick={() => onSelect(region.id)}
              onKeyDown={(event) => onKey(event, region.id)}
            >
              <circle className="hit" r={30} />
              <circle className="dot" r={isSelected ? 21 : 18} />
              <text className="value" dy="0.35em">
                {value === null ? "—" : value}
              </text>
              {isSelected ? (
                <g className="name-pill" transform="translate(0 33)">
                  <rect x={-28} y={-9} width={56} height={18} rx={9} />
                  <text dy="0.35em">{region.name.toUpperCase()}</text>
                </g>
              ) : (
                <text className="name" y={33} dy="0.35em">
                  {region.name.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {unplaced.length > 0 && (
        <div className="unplaced">
          {unplaced.map((region) => (
            <button
              key={region.id}
              type="button"
              className={region.id === selected ? "chip selected" : "chip"}
              aria-pressed={region.id === selected}
              onClick={() => onSelect(region.id)}
            >
              {describe(region)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
