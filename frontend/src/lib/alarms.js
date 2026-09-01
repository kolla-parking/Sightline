// Alarm doctrine copy (EEMUA 191 / ISA 18.2 via BRAND.md): every alert
// reads VERB-FIRST — what to do, then what happened. Raw detections never
// use this vocabulary; they stay in the activity log. Presentation only.

export const ALERT_DOCTRINE = {
  overstay: { verb: "Dispatch attendant", noun: "overstay" },
  unauthorized: { verb: "Validate permit", noun: "unauthorized use" },
  double_park: { verb: "Dispatch attendant", noun: "double parking" },
  camera_offline: { verb: "Restart camera", noun: "camera offline" },
  camera_online: { verb: "Confirm recovery", noun: "camera recovered" },
  congestion: { verb: "Redirect arrivals", noun: "congestion risk" },
  charger_contention: { verb: "Free EV chargers", noun: "charger contention" },
  zone_full: { verb: "Prepare overflow", noun: "zone full risk" },
  overstay_pressure: { verb: "Schedule patrol", noun: "overstay pressure" },
};

export function alertVerb(kind) {
  return ALERT_DOCTRINE[kind]?.verb || "Review";
}

export function alertNoun(kind) {
  return ALERT_DOCTRINE[kind]?.noun || String(kind).replace(/_/g, " ");
}
