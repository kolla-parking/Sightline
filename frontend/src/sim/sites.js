// Site catalog + generated geometry for the digital twin.
//
// One site (`sample-lot`) is backed by the real backend camera; everything
// else is simulated. Geometry is generated deterministically: every space
// gets a map polygon (lat/lng) and a schematic rect (local 0..1000 units)
// so the twin can render either projection.

const M_LAT = 1 / 111320; // meters -> degrees latitude

function mLng(lat) {
  return 1 / (111320 * Math.cos((lat * Math.PI) / 180));
}

// Axis-aligned space rect rotated by `deg` around its center -> [lng,lat] ring
function spacePoly(lat, lng, wM, hM, deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = wM / 2;
  const hh = hM / 2;
  const pts = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => {
    const rx = x * cos - y * sin;
    const ry = x * sin + y * cos;
    return [lng + rx * mLng(lat), lat + ry * M_LAT];
  });
  pts.push(pts[0]);
  return pts;
}

function specialType(index, rowLen, opts) {
  const { ev = 0, ada = 0, reserved = 0 } = opts;
  if (index < ada) return "ada";
  if (index < ada + ev) return "ev";
  if (index >= rowLen - reserved) return "reserved";
  return "standard";
}

// Rows of spaces marching east, aisles between rows.
function surfaceGrid({ site, lat, lng, rows, cols, angle = 0, zoneOf, special = {}, sw = 2.7, sh = 5.6, aisle = 7.5, level = null, labelPrefix = "" }) {
  const spaces = [];
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      n += 1;
      const lx = (c - cols / 2) * sw;
      const ly = (r - rows / 2) * (sh + aisle);
      const x = lx * cos - ly * sin;
      const y = lx * sin + ly * cos;
      const sLat = lat + y * M_LAT;
      const sLng = lng + x * mLng(lat);
      spaces.push({
        id: `${site}:${level != null ? `L${level}-` : ""}${String(n).padStart(3, "0")}`,
        label: `${labelPrefix}${level != null ? `L${level}·` : ""}${String(n).padStart(3, "0")}`,
        zone: zoneOf(r, c),
        level,
        type: specialType(c, cols, typeof special === "function" ? special(r) : special),
        poly: spacePoly(sLat, sLng, sw, sh, angle),
        center: [sLng, sLat],
        sx: 20 + (c * 960) / cols,
        sy: 30 + (r * 940) / rows,
        sw: 900 / cols,
        sh: Math.min(64, 700 / rows),
      });
    }
  }
  return spaces;
}

// On-street: spaces in a line along a bearing.
function streetRun({ site, lat, lng, count, bearing, zone, startN, sx0, sy0, dsx, dsy }) {
  const spaces = [];
  const rad = (bearing * Math.PI) / 180;
  const step = 6.2; // meters between space centers along the curb
  for (let i = 0; i < count; i++) {
    const d = i * step;
    const y = Math.cos(rad) * d;
    const x = Math.sin(rad) * d;
    const sLat = lat + y * M_LAT;
    const sLng = lng + x * mLng(lat);
    const n = startN + i;
    spaces.push({
      id: `${site}:${String(n).padStart(3, "0")}`,
      label: `S${String(n).padStart(3, "0")}`,
      zone,
      level: null,
      type: i % 11 === 5 ? "ada" : "standard",
      poly: spacePoly(sLat, sLng, 2.4, 5.8, bearing),
      center: [sLng, sLat],
      sx: sx0 + dsx * i,
      sy: sy0 + dsy * i,
      sw: dsx ? 900 / count : 26,
      sh: dsx ? 22 : 900 / count,
    });
  }
  return spaces;
}

function buildSampleLot() {
  const site = "sample-lot";
  const lat = 30.2661;
  const lng = -97.75;
  const spaces = surfaceGrid({
    site,
    lat,
    lng,
    rows: 4,
    cols: 25,
    angle: 4,
    zoneOf: (r) => (r < 2 ? "A" : "B"),
    special: (r) => (r === 0 ? { ada: 2, ev: 3 } : {}),
  });
  // Real backend slots are PK001..PK100 — map row-major.
  spaces.forEach((s, i) => {
    s.backendId = `PK${String(i + 1).padStart(3, "0")}`;
    s.label = s.backendId;
  });
  return {
    id: site,
    name: "Sample Lot 1",
    kind: "surface",
    real: true,
    address: "W 6th St & Rio Grande, Austin, TX",
    center: [lng, lat],
    mapZoom: 18.2,
    zones: [
      { id: "A", name: "Zone A · North rows" },
      { id: "B", name: "Zone B · South rows" },
    ],
    cameras: [{ id: "cam1", name: "cam1 · North mast", real: true }],
    rate: 2.5,
    limits: { standard: 240, ev: 180, ada: 480, reserved: 720 },
    spaces,
  };
}

function buildGarage() {
  const site = "riverside-garage";
  const lat = 30.2585;
  const lng = -97.7448;
  const levels = 6;
  const spaces = [];
  for (let L = 1; L <= levels; L++) {
    spaces.push(
      ...surfaceGrid({
        site,
        lat,
        lng,
        rows: 4,
        cols: 21,
        angle: -12,
        level: L,
        zoneOf: (r) => `L${L}`,
        special: L === 1 ? (r) => (r === 0 ? { ada: 3, ev: 6 } : {}) : () => ({}),
        aisle: 6.5,
      }),
    );
  }
  return {
    id: site,
    name: "Riverside Garage",
    kind: "garage",
    real: false,
    address: "211 S 1st St, Austin, TX",
    center: [lng, lat],
    mapZoom: 17.8,
    levels,
    zones: Array.from({ length: levels }, (_, i) => ({ id: `L${i + 1}`, name: `Level ${i + 1}` })),
    cameras: Array.from({ length: levels }, (_, i) => ({ id: `rg-l${i + 1}`, name: `Level ${i + 1} dome` })),
    rate: 4,
    limits: { standard: 1440, ev: 240, ada: 1440, reserved: 1440 },
    spaces,
  };
}

function buildStreet() {
  const site = "fifth-street";
  const lat = 30.2687;
  const lng = -97.742;
  const spaces = [
    ...streetRun({ site, lat, lng, count: 18, bearing: 96, zone: "BLK-500", startN: 1, sx0: 30, sy0: 200, dsx: 52, dsy: 0 }),
    ...streetRun({ site, lat: lat - 0.00028, lng, count: 18, bearing: 96, zone: "BLK-500S", startN: 19, sx0: 30, sy0: 320, dsx: 52, dsy: 0 }),
    ...streetRun({ site, lat: lat - 0.0011, lng: lng + 0.0004, count: 14, bearing: 96, zone: "BLK-600", startN: 37, sx0: 130, sy0: 560, dsx: 52, dsy: 0 }),
    ...streetRun({ site, lat: lat + 0.0006, lng: lng + 0.0013, count: 14, bearing: 6, zone: "CROSS-A", startN: 51, sx0: 860, sy0: 120, dsx: 0, dsy: 52 }),
  ];
  return {
    id: site,
    name: "5th Street On-Street",
    kind: "street",
    real: false,
    address: "E 5th St corridor, Austin, TX",
    center: [lng + 0.0004, lat - 0.0002],
    mapZoom: 17.2,
    zones: [
      { id: "BLK-500", name: "500 block · north curb" },
      { id: "BLK-500S", name: "500 block · south curb" },
      { id: "BLK-600", name: "600 block" },
      { id: "CROSS-A", name: "Trinity St cross" },
    ],
    cameras: [
      { id: "st-pole-1", name: "Pole cam · 500 blk" },
      { id: "st-pole-2", name: "Pole cam · 600 blk" },
    ],
    rate: 3,
    limits: { standard: 120, ev: 120, ada: 240, reserved: 120 },
    spaces,
  };
}

function buildAirport() {
  const site = "airport-a";
  const lat = 30.2027;
  const lng = -97.672;
  const spaces = surfaceGrid({
    site,
    lat,
    lng,
    rows: 10,
    cols: 42,
    angle: 22,
    zoneOf: (r, c) => (r < 5 ? (c < 21 ? "A1" : "A2") : c < 21 ? "A3" : "A4"),
    special: (r) => (r === 0 ? { ada: 4, ev: 8 } : {}),
    aisle: 7,
  });
  return {
    id: site,
    name: "Airport Long-Term A",
    kind: "airport",
    real: false,
    address: "3600 Presidential Blvd, Austin-Bergstrom",
    center: [lng, lat],
    mapZoom: 16.9,
    zones: [
      { id: "A1", name: "A1 · Northwest" },
      { id: "A2", name: "A2 · Northeast" },
      { id: "A3", name: "A3 · Southwest" },
      { id: "A4", name: "A4 · Southeast" },
    ],
    cameras: [
      { id: "ap-m1", name: "Mast 1 · rows 1–5" },
      { id: "ap-m2", name: "Mast 2 · rows 6–10" },
      { id: "ap-gate", name: "Entry gate LPR" },
    ],
    rate: 1.2,
    limits: { standard: 20160, ev: 20160, ada: 20160, reserved: 20160 },
    spaces,
  };
}

function buildTruckYard() {
  const site = "northgate-yard";
  const lat = 30.332;
  const lng = -97.711;
  const spaces = surfaceGrid({
    site,
    lat,
    lng,
    rows: 3,
    cols: 16,
    angle: -3,
    zoneOf: (r) => ["DOCK", "STAGE", "OVERNIGHT"][r],
    sw: 4.2,
    sh: 18,
    aisle: 22,
  }).map((s) => ({ ...s, type: "truck" }));
  return {
    id: site,
    name: "Northgate Truck Yard",
    kind: "truck",
    real: false,
    address: "9800 N Lamar Blvd, Austin, TX",
    center: [lng, lat],
    mapZoom: 17,
    zones: [
      { id: "DOCK", name: "Dock apron" },
      { id: "STAGE", name: "Staging" },
      { id: "OVERNIGHT", name: "Overnight bays" },
    ],
    cameras: [
      { id: "ty-n", name: "North gantry" },
      { id: "ty-s", name: "South gantry" },
    ],
    rate: 6,
    limits: { standard: 720, truck: 720 },
    spaces,
  };
}

export const SITES = [
  buildSampleLot(),
  buildGarage(),
  buildStreet(),
  buildAirport(),
  buildTruckYard(),
];

export const SITE_IDS = SITES.map((s) => s.id);

export const siteById = Object.fromEntries(SITES.map((s) => [s.id, s]));

export const spaceById = {};
for (const site of SITES) {
  for (const sp of site.spaces) spaceById[sp.id] = sp;
}

export const KIND_LABEL = {
  surface: "Surface lot",
  garage: "Garage",
  street: "On-street",
  airport: "Airport",
  truck: "Truck yard",
};

export const CITY_CENTER = [-97.7305, 30.2672];
