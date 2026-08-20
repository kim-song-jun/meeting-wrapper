export const GRID_EVENT_TWO_LINE_MIN_PX = 44;

export function eventContentMode(heightPx: number): "organizer-only" | "organizer-time" {
  if (!Number.isFinite(heightPx) || heightPx <= 0) {
    throw new Error(`Grid event height must be a positive number; received ${String(heightPx)}`);
  }
  return heightPx >= GRID_EVENT_TWO_LINE_MIN_PX ? "organizer-time" : "organizer-only";
}
