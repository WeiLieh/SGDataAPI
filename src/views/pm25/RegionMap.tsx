import type { Pm25Region } from "../../../shared/datasets/pm25";
import type { ScreenConfig } from "../screens";

/**
 * Outline of Singapore island traced from the owner's reference drawing (2026-10-17), in that
 * drawing's own coordinates (about 2:1 wide). Decoration only: no reading comes from here.
 */
const ISLAND: Array<[number, number]> = [
  [455, 40], [515, 44], [575, 63], [630, 90], [690, 122], [745, 150], [815, 172], [868, 184],
  [900, 196], [910, 210], [882, 255], [845, 300], [797, 338], [745, 352], [690, 358], [645, 375],
  [600, 405], [565, 428], [545, 450], [530, 457], [503, 460], [447, 459], [420, 452], [405, 435],
  [388, 408], [340, 384], [285, 372], [235, 366], [135, 370], [93, 358], [77, 327], [87, 292],
  [155, 197], [165, 152], [177, 128], [205, 102], [233, 85], [255, 81], [305, 87], [355, 80],
  [420, 50],
];

/** Drawing coordinates of the island's corners: west, east, north and south edges. */
const ISLAND_BOX = { left: 77, right: 910, top: 40, bottom: 460 };
/** The same edges in longitude and latitude, used to place the regions on the drawing. */
const GEO_BOX = { west: 103.605, east: 104.045, north: 1.47, south: 1.215 };

/** Regions are spread around Central so the circles and names never overlap each other. */
const SPREAD = { x: 1.45, y: 2.3 };
/** North is nearer Central (its name sits above its circle, so it needs less room). */
const NORTH_SPREAD_Y = 1.9;
/** Room above and below the island for circles that spill past it (owner: that is fine). */
const MARGIN = { x: 15, top: 140, bottom: 140 };

const VIEW_W = ISLAND_BOX.right - ISLAND_BOX.left + 2 * MARGIN.x;
const VIEW_H = ISLAND_BOX.bottom - ISLAND_BOX.top + MARGIN.top + MARGIN.bottom;

/** An island drawing point in viewBox units. */
function drawingPoint(x: number, y: number): { x: number; y: number } {
  return { x: x - ISLAND_BOX.left + MARGIN.x, y: y - ISLAND_BOX.top + MARGIN.top };
}

/** Longitude and latitude to drawing coordinates, without spreading. */
function geoToDrawing(longitude: number, latitude: number): { x: number; y: number } {
  const fx = (longitude - GEO_BOX.west) / (GEO_BOX.east - GEO_BOX.west);
  const fy = (GEO_BOX.north - latitude) / (GEO_BOX.north - GEO_BOX.south);
  return {
    x: ISLAND_BOX.left + fx * (ISLAND_BOX.right - ISLAND_BOX.left),
    y: ISLAND_BOX.top + fy * (ISLAND_BOX.bottom - ISLAND_BOX.top),
  };
}

const CENTRE = geoToDrawing(103.82, 1.35735);

/** A region's position in viewBox units: its true place, spread out from Central. */
function mapPoint(longitude: number, latitude: number, spreadY = SPREAD.y): { x: number; y: number } {
  const { x, y } = geoToDrawing(longitude, latitude);
  return drawingPoint(CENTRE.x + (x - CENTRE.x) * SPREAD.x, CENTRE.y + (y - CENTRE.y) * spreadY);
}

function islandPath(): string {
  const points = ISLAND.map(([x, y]) => drawingPoint(x, y));
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
  /** Unit after a value in screen-reader labels; null for an index such as PSI. */
  unit: string | null;
  band: ScreenConfig["band"];
}

export function RegionMap({ regions, values, selected, onSelect, unit, band: bandOf }: Props) {
  const placed = regions.filter((r) => r.latitude !== null && r.longitude !== null);
  const unplaced = regions.filter((r) => r.latitude === null || r.longitude === null);

  const describe = (region: Pm25Region) => {
    const value = values[region.id] ?? null;
    const band = bandOf(value);
    const amount = unit ? `${value} ${unit}` : `${value}`;
    return value === null ? `${region.name}: no reading` : `${region.name}: ${amount}, ${band?.label ?? ""}`;
  };

  return (
    <div className="region-map">
      {/*
        Only the island is SVG. Each region is an HTML button placed over it: iOS Safari did not
        reliably repaint SVG <text> after a tap (numbers and names went blank), while HTML text
        and buttons render consistently and are natively tappable and keyboard-accessible.
      */}
      <div className="map-canvas" role="group" aria-label="Singapore regions" style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}>
        <svg className="island-svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true">
          <path className="island" d={ISLAND_PATH} />
        </svg>
        {placed.map((region) => {
          const isNorth = region.id === "north";
          const { x, y } = mapPoint(region.longitude!, region.latitude!, isNorth ? NORTH_SPREAD_Y : SPREAD.y);
          const value = values[region.id] ?? null;
          const tone = bandOf(value)?.tone ?? "none";
          const isSelected = region.id === selected;
          return (
            <button
              key={region.id}
              type="button"
              className={`region tone-${tone}${isSelected ? " selected" : ""}${isNorth ? " label-above" : ""}`}
              style={{ left: `${((x / VIEW_W) * 100).toFixed(2)}%`, top: `${((y / VIEW_H) * 100).toFixed(2)}%` }}
              aria-pressed={isSelected}
              aria-label={describe(region)}
              onClick={() => onSelect(region.id)}
            >
              <span className={value !== null && value >= 1000 ? "dot long" : "dot"} aria-hidden="true">
                {value === null ? "—" : value}
              </span>
              <span className="name" aria-hidden="true">
                {region.name.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>
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
