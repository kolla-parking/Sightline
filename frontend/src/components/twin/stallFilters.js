// Twin state filters — one vocabulary for both projections.
//
// The active filter DIMS non-matching stalls (fill/stroke opacity drops);
// geometry is never hidden, so the operator keeps spatial context. Filters
// compose with level chips and the replay cursor (matching is evaluated
// against the snapshot at the viewed time).

import { LOW_CONFIDENCE } from "../../sim/engine.js";

export const STALL_FILTERS = [
  { value: "all", label: "All" },
  { value: "overstay", label: "Overstays" },
  { value: "lowconf", label: "Low conf" },
  { value: "evada", label: "EV·ADA" },
  { value: "open", label: "Open" },
];

export const STALL_FILTER_LABEL = Object.fromEntries(
  STALL_FILTERS.map((f) => [f.value, f.label]),
);

export function matchesStallFilter(filter, space, st) {
  if (!filter || filter === "all") return true;
  switch (filter) {
    case "overstay":
      return !!st?.overstay;
    case "lowconf":
      return !!(st?.session && st.session.confidence < LOW_CONFIDENCE);
    case "evada":
      return space?.type === "ev" || space?.type === "ada";
    case "open":
      return !st || st.status === "free";
    default:
      return true;
  }
}
