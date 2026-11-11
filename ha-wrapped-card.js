/**
 * Home Assistant Wrapped — a year-in-review story for your smart home.
 *
 * Install through HACS / the Marketplace (custom repository), or copy to
 * /config/www/ha-wrapped-card.js and add it as a dashboard resource
 * (/local/ha-wrapped-card.js, type: module). Then add a card:
 *   type: custom:ha-wrapped-card
 *   year: 2026   # optional, defaults to the current year
 *
 * Needs an admin user (registry + recorder websocket commands).
 */

const VERSION = "1.2.0";
console.info(`%c HA-WRAPPED-CARD %c v${VERSION} `, "color:#1d2126;background:#18bcf2;font-weight:700", "color:#18bcf2;background:#1d2126");

const HELPER_DOMAINS = new Set([
  "template", "group", "utility_meter", "switch_as_x", "derivative", "integration",
  "min_max", "threshold", "trend", "statistics", "history_stats", "filter", "tod",
  "random", "counter", "timer", "schedule", "generic_thermostat", "generic_hygrostat",
  "mold_indicator", "combine", "bayesian",
]);
const SKIP_SOURCES = new Set(["system", "onboarding", "import", "ignore"]);
const STORE_DOMAINS = new Set(["hacs", "marketplace"]);
const WEATHER_PLATFORMS = new Set([
  "aemet", "met", "open_meteo", "openweathermap", "accuweather", "pirateweather",
  "buienradar", "meteo_france", "dwd_weather_warnings", "knmi", "smhi", "nws",
  "environment_canada", "met_eireann", "bom", "weatherflow", "tomorrowio",
]);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const CACHE_MS = 6 * 60 * 60 * 1000; // re-gather at most every 6 hours

/* ------------------------------------------------------------------ data -- */

async function collectWrapped(hass, year, onCore) {
  const tz = hass.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const inYear = (ts) => ts && ts * 1000 >= start.getTime() && ts * 1000 < end.getTime();
  const parts = (ts) => {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour: "numeric", hourCycle: "h23", weekday: "long", month: "numeric", day: "numeric",
    }).formatToParts(new Date(ts * 1000));
    const g = (t) => f.find((p) => p.type === t)?.value;
    return { hour: +g("hour"), weekday: g("weekday"), month: +g("month") - 1, day: +g("day") };
  };

  // Ask for the list of sensor statistics right away; it's only needed for the
  // slow energy and climate sheets, which load after the rest.
  const statIdsReq = hass.callWS({ type: "recorder/list_statistic_ids" })
    .catch((e) => { console.warn("ha-wrapped: statistics unavailable", e); return []; });

  // Everything that doesn't depend on something else goes out in one round trip.
  const [entries, devices, entities, areas, manifests] = await Promise.all([
    hass.callWS({ type: "config_entries/get" }),
    hass.callWS({ type: "config/device_registry/list" }),
    hass.callWS({ type: "config/entity_registry/list" }),
    hass.callWS({ type: "config/area_registry/list" }),
    hass.callWS({ type: "manifest/list" }).catch(() => []), // loaded integrations' names
  ]);
  const entryById = Object.fromEntries(entries.map((e) => [e.entry_id, e]));
  const areaName = Object.fromEntries(areas.map((a) => [a.area_id, a.name]));
  const deviceById = Object.fromEntries(devices.map((d) => [d.id, d]));

  // Integration display names
  const names = Object.fromEntries(manifests.map((m) => [m.domain, m.name]));
  const nameOf = (d) => names[d] || d.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // ---- integrations
  const userEntries = entries.filter((e) => !SKIP_SOURCES.has(e.source) && !STORE_DOMAINS.has(e.domain));
  const newEntries = userEntries.filter((e) => inYear(e.created_at)).sort((a, b) => a.created_at - b.created_at);
  const integrationsNew = newEntries.filter((e) => !HELPER_DOMAINS.has(e.domain));
  const helpersNew = newEntries.filter((e) => HELPER_DOMAINS.has(e.domain));
  const firstSeen = {};
  for (const e of entries) firstSeen[e.domain] = Math.min(firstSeen[e.domain] ?? Infinity, e.created_at || 0);
  const newDomains = [...new Set(integrationsNew.map((e) => e.domain))].filter((d) => inYear(firstSeen[d]));

  // ---- devices
  const domainOfDevice = (d) => {
    const e = d.config_entries?.map((id) => entryById[id]).find(Boolean);
    return e?.domain;
  };
  const realDevices = devices.filter((d) => d.entry_type !== "service" && !STORE_DOMAINS.has(domainOfDevice(d)));
  const apps = realDevices.filter((d) => domainOfDevice(d) === "hassio" && d.model === "Home Assistant App");
  const things = realDevices.filter((d) => domainOfDevice(d) !== "hassio");
  const newDevices = things.filter((d) => inYear(d.created_at)).sort((a, b) => a.created_at - b.created_at);
  const newApps = apps.filter((d) => inYear(d.created_at));

  const countBy = (arr, key) => {
    const m = new Map();
    for (const x of arr) { const k = key(x); if (k) m.set(k, (m.get(k) || 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const topDomains = countBy(newDevices, domainOfDevice).map(([d, n]) => [nameOf(d), n, d]);
  const topMakers = countBy(newDevices, (d) => {
    const m = (d.manufacturer || "").trim();
    if (!m || /^(home assistant|esphome|zigbee|unknown)$/i.test(m)) return null;
    return m.replace(/\s*\(.*\)$/, "").replace(/ of sweden$/i, "").replace(/, inc\.?$/i, "")
      .replace(/^\w/, (c) => c.toUpperCase());
  });
  const busiestRoom = countBy(newDevices, (d) => areaName[d.area_id]);

  // ---- habits (when do you tinker?)
  const events = [...newEntries.map((e) => e.created_at), ...newDevices.map((d) => d.created_at)].map(parts);
  const night = events.filter((p) => p.hour >= 22 || p.hour < 5).length;
  const weekend = events.filter((p) => p.weekday === "Saturday" || p.weekday === "Sunday").length;
  const byMonth = Array(12).fill(0);
  events.forEach((p) => byMonth[p.month]++);
  const byDay = countBy(events, (p) => p.weekday);
  const byHour = Array(24).fill(0);
  events.forEach((p) => byHour[p.hour]++);
  const peakHour = byHour.indexOf(Math.max(...byHour));

  // ---- statistics
  const entityById = Object.fromEntries(entities.map((e) => [e.entity_id, e]));
  const areaOfEntity = (id) => {
    const e = entityById[id];
    if (!e) return null;
    return areaName[e.area_id] || areaName[deviceById[e.device_id]?.area_id] || null;
  };
  const friendly = (id) => {
    const e = entityById[id];
    const dev = deviceById[e?.device_id];
    return dev?.name_by_user || dev?.name || hass.states[id]?.attributes?.friendly_name || id;
  };

  // A year of sensor statistics is the slow part. It runs on its own so the
  // slides that don't need it can be shown first.
  const statsPromise = (async () => {
    let energy = null;
    let climate = null;
    try {
      const statIds = await statIdsReq;
      const sensorStat = (s) => s.statistic_id.startsWith("sensor.");
      const energyIds = statIds.filter((s) => sensorStat(s) && s.has_sum && s.unit_class === "energy"
        && !/returned|export|production|solar|feed_in/i.test(s.statistic_id));
      const tempIds = statIds.filter((s) => sensorStat(s) && s.has_mean && s.unit_class === "temperature"
        && !/nozzle|bed_temp|cpu|chip|wash|water|forecast|feeling|dew|_target|setpoint/i.test(s.statistic_id));

      const period = (ids, types) => ids.length ? hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(), end_time: end.toISOString(),
        statistic_ids: ids.map((s) => s.statistic_id), period: "month", types,
      }) : {};
      const [eStats, tStats] = await Promise.all([
        period(energyIds, ["change"]),
        period(tempIds, ["mean", "min", "max"]),
      ]);

      // Energy: one total per device (devices often expose several energy sensors)
      const perDevice = new Map();
      const monthly = Array(12).fill(0);
      for (const [id, rows] of Object.entries(eStats)) {
        const unit = energyIds.find((s) => s.statistic_id === id)?.statistics_unit_of_measurement;
        const k = unit === "Wh" ? 0.001 : unit === "MWh" ? 1000 : 1;
        const months = Array(12).fill(0);
        rows.forEach((r) => { months[new Date(r.start).getMonth()] += Math.max(0, r.change || 0) * k; });
        const total = months.reduce((a, b) => a + b, 0);
        const devKey = entityById[id]?.device_id || id;
        const prev = perDevice.get(devKey);
        if (!prev || total > prev.total) perDevice.set(devKey, { id, total, months });
      }
      const consumers = [...perDevice.values()].filter((c) => c.total > 0.01).sort((a, b) => b.total - a.total);
      if (consumers.length) {
        consumers.forEach((c) => c.months.forEach((v, i) => { monthly[i] += v; }));
        energy = {
          total: consumers.reduce((a, c) => a + c.total, 0),
          top: consumers.slice(0, 4).map((c) => ({ name: friendly(c.id), kwh: c.total })),
          monthly,
          peakMonth: monthly.indexOf(Math.max(...monthly)),
          count: consumers.length,
        };
      }

      // Climate: indoor rooms vs outside
      const rooms = [];
      let outside = null;
      for (const [id, rows] of Object.entries(tStats)) {
        if (!rows.length) continue;
        const max = Math.max(...rows.map((r) => r.max ?? -Infinity));
        const min = Math.min(...rows.map((r) => r.min ?? Infinity));
        const mean = rows.reduce((a, r) => a + (r.mean ?? 0), 0) / rows.length;
        const platform = entityById[id]?.platform;
        const isOutside = WEATHER_PLATFORMS.has(platform) || /outside|outdoor|exterior/i.test(id);
        if (isOutside) {
          if (!outside || max > outside.max) {
            const hot = rows.reduce((a, r) => (r.max > a.max ? r : a));
            outside = { max, min, month: new Date(hot.start).getMonth() };
          }
          continue;
        }
        const room = areaOfEntity(id);
        if (room) rooms.push({ room, max, min, mean });
      }
      // Keep the warmest sensor per room
      const byRoom = new Map();
      rooms.forEach((r) => { if (!byRoom.has(r.room) || r.mean > byRoom.get(r.room).mean) byRoom.set(r.room, r); });
      const roomList = [...byRoom.values()].sort((a, b) => b.mean - a.mean);
      if (roomList.length || outside) {
        climate = {
          rooms: roomList,
          hottest: [...roomList].sort((a, b) => b.max - a.max)[0],
          // Coolest = lowest average, so a single cold spike doesn't win
          coldest: roomList.at(-1),
          outside,
          unit: hass.config?.unit_system?.temperature || "°C",
        };
      }
    } catch (err) {
      console.warn("ha-wrapped: statistics unavailable", err);
    }
    return { energy, climate };
  })();

  // ---- home today
  const states = Object.keys(hass.states);
  const dom = (d) => states.filter((s) => s.startsWith(d + ".")).length;
  const now = {
    entities: entities.length,
    entitiesNew: entities.filter((e) => inYear(e.created_at)).length,
    automations: dom("automation"),
    scripts: dom("script"),
    scenes: dom("scene"),
    areas: areas.length,
    people: dom("person"),
  };

  // ---- personality
  const has = (d) => newDevices.filter((x) => domainOfDevice(x) === d).length;
  const archetypes = [
    { score: has("esphome") * 3, name: "The Maker", emoji: "🛠️", line: "You don't buy a smart home. You build one." },
    { score: (has("zha") + has("zwave_js") + has("matter") + has("mqtt")) * 1.2, name: "The Mesh Master", emoji: "🕸️", line: "Your radios have never been busier." },
    { score: dom("climate") * 3, name: "The Climate Commander", emoji: "🌡️", line: "Every room, exactly the right temperature." },
    { score: dom("media_player") * 1.2, name: "The DJ", emoji: "🎧", line: "Music in every room, on cue." },
    { score: now.automations * 0.8, name: "The Automator", emoji: "🤖", line: "Why press a button when your house can do it?" },
  ].sort((a, b) => b.score - a.score);

  const core = {
    year, tz,
    integrations: {
      count: integrationsNew.length,
      domains: newDomains.length,
      helpers: helpersNew.length,
      first: integrationsNew[0] && { name: nameOf(integrationsNew[0].domain), title: integrationsNew[0].title, date: integrationsNew[0].created_at },
      latest: integrationsNew.at(-1) && { name: nameOf(integrationsNew.at(-1).domain), title: integrationsNew.at(-1).title, date: integrationsNew.at(-1).created_at },
      byMonth: (() => { const m = Array(12).fill(0); integrationsNew.forEach((e) => m[parts(e.created_at).month]++); return m; })(),
    },
    devices: {
      count: newDevices.length,
      total: things.length,
      topDomains: topDomains.slice(0, 5),
      topMaker: topMakers[0],
      makers: topMakers.length,
      room: busiestRoom[0],
      first: newDevices[0] && { name: newDevices[0].name_by_user || newDevices[0].name, date: newDevices[0].created_at },
      latest: newDevices.at(-1) && { name: newDevices.at(-1).name_by_user || newDevices.at(-1).name, date: newDevices.at(-1).created_at },
    },
    apps: { count: newApps.length, names: newApps.map((a) => a.name).slice(0, 6) },
    habits: {
      total: events.length,
      nightPct: events.length ? Math.round((night / events.length) * 100) : 0,
      weekendPct: events.length ? Math.round((weekend / events.length) * 100) : 0,
      byMonth, peakMonth: byMonth.indexOf(Math.max(...byMonth)),
      topDay: byDay[0]?.[0], peakHour, byHour,
    },
    energy: null, climate: null, statsPending: true, now,
    archetype: archetypes[0],
  };
  onCore?.(core);
  const stats = await statsPromise;
  return { ...core, ...stats, statsPending: false };
}

/* -------------------------------------------------------------- helpers -- */

const fmtDot = (ts, tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "2-digit" })
  .format(new Date(ts * 1000)).replace("/", ".");
const fmtHour = (h) => `${String(h).padStart(2, "0")}:00`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const pad = (n, l = 2) => String(n).padStart(l, "0");
const MON = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MONTH3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Tiny deterministic PRNG, so a slide's paper stack looks the same every time.
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const hash = (text) => [...String(text)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/* ------------------------------------------------------- micro-graphics -- */

// Line glyphs in the spirit of compliance marks on device labels.
const GLYPHS = {
  house: '<path d="M3 11.5 12 4l9 7.5V20H3z"/><path d="M15.5 6.5V3.5h2.5v5"/>',
  cross: '<path d="M12 1v22M1 12h22"/><circle cx="12" cy="12" r="5"/>',
  quad: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 9 9h-9zM12 12v9a9 9 0 0 1-9-9z" fill="currentColor" stroke="none"/>',
  sq2: '<rect x="3" y="3" width="18" height="18"/><rect x="8" y="8" width="8" height="8"/>',
  bolt: '<path d="M12 2.5 22.5 20.5h-21z"/><path d="m13 9-2.5 4.5h3L11 18"/>',
  ring: '<circle cx="8.5" cy="12" r="6"/><circle cx="15.5" cy="12" r="6"/>',
  nodes: '<circle cx="5" cy="6" r="2.2"/><circle cx="19" cy="6" r="2.2"/><circle cx="12" cy="18.5" r="2.2"/><path d="M7.2 6h9.6M6.2 8l4.7 8.6M17.8 8l-4.7 8.6"/>',
  thermo: '<path d="M10 4.5a2 2 0 0 1 4 0v9.7a4.2 4.2 0 1 1-4 0z"/><path d="M12 9v8.5"/>',
  wave: '<path d="M1.5 12h3l2.2-6.5 3.3 13 3.2-10 2.3 6.5 1.8-3h5.2"/>',
  wrench: '<path d="M14.5 3.5a5 5 0 0 0 6 6L10 20a2.1 2.1 0 0 1-3-3L17.5 6.5a5 5 0 0 0-3-3z"/>',
  gear: '<circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3.5M12 19v3.5M1.5 12H5M19 12h3.5M4.6 4.6l2.4 2.4M17 17l2.4 2.4M4.6 19.4 7 17M17 7l2.4-2.4"/>',
  plug: '<path d="M8 2v5M16 2v5M5 7h14v4a7 7 0 0 1-14 0zM12 18v4"/>',
  grid: '<rect x="3" y="3" width="18" height="18"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  person: '<circle cx="12" cy="7" r="3.5"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  bracket: '<path d="M8 3H4v18h4M16 3h4v18h-4"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
  checker: Array.from({ length: 16 }, (_, i) => ((i + Math.floor(i / 4)) % 2
    ? "" : `<rect x="${3 + (i % 4) * 4.5}" y="${3 + Math.floor(i / 4) * 4.5}" width="4.5" height="4.5" fill="currentColor" stroke="none"/>`)).join(""),
};
const glyph = (k, cls = "") => `<svg class="g ${cls}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[k] || ""}</svg>`;

// A fake barcode, stable for a given text.
function barcode(text, bars = 44) {
  const r = rng(hash(text));
  let x = 0;
  let out = "";
  for (let i = 0; i < bars; i++) {
    const w = 1 + Math.floor(r() * 3);
    if (i % 2 === 0) out += `<rect x="${x}" y="0" width="${w}" height="20"/>`;
    x += w;
  }
  return `<svg class="barcode" viewBox="0 0 ${x} 20" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`;
}

const tag = (text, cls = "") => `<span class="tag ${cls}">[ ${text} ]</span>`;

// Key/value rows, like the INPUT/OUTPUT block on a power supply label.
const spec = (rows) => `<dl class="spec">${rows.filter(Boolean).map(([k, v, hi]) =>
  `<div${hi ? ' class="hi"' : ""}><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;

// Proportion as a row of pips.
const pips = (frac, n = 24) => `<div class="pips" aria-hidden="true">${Array.from({ length: n }, (_, i) =>
  `<i class="${i < Math.round(frac * n) ? "on" : ""}" style="--i:${i}"></i>`).join("")}</div>`;

// Thin-line histogram with an axis and a caption.
function ticks(values, labels, opts = {}) {
  const max = Math.max(...values, 0.0001);
  const hi = values.indexOf(Math.max(...values));
  return `<figure class="ticks">
    <div class="tk-plot">${values.map((v, i) =>
      `<i class="${i === hi ? "hi" : ""}" style="--h:${Math.max(1.5, (v / max) * 100)}%;--i:${i}" title="${esc(opts.titles?.[i] ?? labels[i])}: ${num(v, opts.dp || 0)}"></i>`).join("")}</div>
    <div class="tk-axis">${labels.map((l, i) => `<span class="${i === hi ? "hi" : ""}">${l}</span>`).join("")}</div>
    <figcaption><span>${esc(opts.caption || "")}</span><span>MAX ${num(max, opts.dp || 0)}${opts.unit || ""}</span></figcaption>
  </figure>`;
}

// Min–max range with a mean marker, for room temperatures.
function rangeRow(r, lo, hi) {
  const p = (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  return `<div class="rng"><span class="rng-l">${esc(r.room)}</span>
    <span class="rng-t"><i style="left:${p(r.min)}%;width:${p(r.max) - p(r.min)}%"></i><b style="left:${p(r.mean)}%"></b></span>
    <span class="rng-v">${num(r.mean, 1)}°</span></div>`;
}

// Several sheets of drafting paper, slightly rotated and out of focus.
function sheets(seed, ghost) {
  const r = rng(seed + 11);
  const layer = (i) => {
    const rot = (r() * 5 - 2.5).toFixed(2);
    const tx = (r() * 8 - 4).toFixed(1);
    const ty = (r() * 6 - 3).toFixed(1);
    const cx = (12 + r() * 66).toFixed(1);
    const cy = (20 + r() * 120).toFixed(1);
    const rad = (6 + r() * 16).toFixed(1);
    const fy = (14 + r() * 120).toFixed(1);
    const fx = (6 + r() * 40).toFixed(1);
    const lines = Array.from({ length: 5 }, (_, k) =>
      `<rect x="${fx}" y="${(+fy + 3 + k * 1.6).toFixed(1)}" width="${(8 + r() * 22).toFixed(1)}" height=".55"/>`).join("");
    const dimY = (8 + r() * 140).toFixed(1);
    const blue = i === 1 ? " blue" : "";
    return `<div class="sheet s${i}${blue}" style="--rot:${rot}deg;--tx:${tx}%;--ty:${ty}%">
      <svg viewBox="0 0 90 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g class="ln">
          <circle cx="${cx}" cy="${cy}" r="${rad}"/><circle cx="${cx}" cy="${cy}" r="${(rad / 2.4).toFixed(1)}"/>
          <path d="M${cx - rad - 5} ${cy}h${rad * 2 + 10}M${cx} ${cy - rad - 5}v${rad * 2 + 10}"/>
          <rect x="${fx}" y="${fy}" width="${(24 + r() * 26).toFixed(1)}" height="${(12 + r() * 22).toFixed(1)}"/>
          <path d="M6 ${dimY}h78M6 ${dimY - 2}v4M84 ${dimY - 2}v4"/>
          <path d="M4 4h5M4 4v5M86 4h-5M86 4v5M4 156h5M4 156v-5M86 156h-5M86 156v-5"/>
        </g>
        <g class="tx">${lines}</g>
        ${i === 2 && ghost ? `<text class="ghost" x="-4" y="${(60 + r() * 60).toFixed(0)}">${esc(ghost)}</text>` : ""}
      </svg>
    </div>`;
  };
  return `<div class="sheets" aria-hidden="true">${[0, 1, 2].map(layer).join("")}</div>`;
}

/* --------------------------------------------------------------- slides -- */

function introSlide(year, loading = false) {
  return {
    key: "INTRO",
    ghost: String(year),
    html: `
      <div class="row">${tag("YEAR IN REVIEW")}${tag(`REF.${year}`, "blue")}</div>
      <p class="mono sm dim">HOME ASSISTANT — ANNUAL REPORT</p>
      <h1 class="hero">Wrapped<span class="blue">.</span></h1>
      <div class="yr"><span>${year}</span>${glyph("cross", "lg")}</div>
      ${spec([
        ["SUBJECT", "YOUR HOME"],
        ["PERIOD", `01.01 — 31.12.${year}`],
        ["FORMAT", "TAP-THROUGH · SHEETS"],
      ])}
      <div class="marks">${["house", "quad", "checker", "sq2", "ring", "bolt"].map((g) => glyph(g)).join("")}</div>
      <div class="hint mono">${loading ? "GATHERING YOUR YEAR…" : "TAP TO BEGIN →"}</div>`,
  };
}

// Stands in for the energy and climate sheets until the statistics arrive.
function readingsSlide(year) {
  return {
    key: "READINGS",
    ghost: "SCAN",
    html: `
      <div class="row">${tag("07 / READINGS")}${glyph("wave")}</div>
      <p class="lead">Reading a year of sensor history</p>
      <div class="scan" aria-hidden="true"><i></i></div>
      ${spec([
        ["SOURCE", "RECORDER · LONG-TERM STATS"],
        ["RANGE", `01.01 — 31.12.${year}`],
        ["STATUS", '<span class="blink">ACQUIRING…</span>', true],
      ])}
      <p class="mono sm dim">ENERGY + CLIMATE SHEETS SLOT IN HERE WHEN READY</p>
      <div class="hint mono">TAP TO CONTINUE →</div>`,
  };
}

function buildSlides(w) {
  const s = [];
  const tz = w.tz;
  const yy = String(w.year).slice(-2);

  s.push(introSlide(w.year));

  if (w.integrations.count) {
    const i = w.integrations;
    const peak = i.byMonth.indexOf(Math.max(...i.byMonth));
    s.push({
      key: "INTEGRATIONS",
      ghost: "INTEGRATIONS",
      html: `
        <div class="row">${tag("01 / INTEGRATIONS")}${glyph("plug")}</div>
        <p class="lead">Connected this year</p>
        <div class="big"><span data-count="${i.count}">0</span><sup>INT.</sup></div>
        ${spec([
          ["NEW KINDS", `${i.domains}`],
          ["HELPERS BUILT", `${i.helpers}`],
          ["BUSIEST MONTH", MONTH3[peak], true],
        ])}
        ${ticks(i.byMonth, MON, { caption: "ADDED / MONTH", titles: MONTH3 })}`,
    });
  }

  if (w.integrations.first) {
    const f = w.integrations.first;
    const l = w.integrations.latest;
    const months = Math.max(0, Math.round((l.date - f.date) / (86400 * 30.4)));
    s.push({
      key: "ORIGIN",
      ghost: "ORIGIN",
      html: `
        <div class="row">${tag("02 / ORIGIN")}${glyph("bracket")}</div>
        <div class="label">
          <div class="label-hd"><span>FIRST ENTRY</span><span>${fmtDot(f.date, tz)}.${yy}</span></div>
          <div class="name">${esc(f.name)}</div>
          <div class="label-ft"><span class="mono sm dim">${esc(f.title)}</span>${barcode(f.name)}</div>
        </div>
        <div class="leader mono sm"><span></span>${months} MONTH${months === 1 ? "" : "S"} LATER<span></span></div>
        <div class="label hi">
          <div class="label-hd"><span>LATEST ENTRY</span><span>${fmtDot(l.date, tz)}.${yy}</span></div>
          <div class="name sm">${esc(l.name)}</div>
          <div class="label-ft"><span class="mono sm dim">${esc(l.title)}</span>${barcode(l.name)}</div>
        </div>`,
    });
  }

  if (w.devices.count) {
    const top = w.devices.topDomains;
    const max = top[0]?.[1] || 1;
    s.push({
      key: "DEVICES",
      ghost: "DEVICES",
      html: `
        <div class="row">${tag("03 / DEVICES")}${glyph("nodes")}</div>
        <p class="lead">New devices welcomed</p>
        <div class="big"><span data-count="${w.devices.count}">0</span><sup>DEV.</sup></div>
        <ol class="rank">${top.map(([n, c], i) => `
          <li style="--i:${i}">
            <span class="idx">${pad(i + 1)}</span>
            <span class="lbl">${esc(n)}</span>
            <b>${c}</b>
            <span class="bar"><i style="--w:${(c / max) * 100}%"></i></span>
          </li>`).join("")}
        </ol>`,
    });
  }

  if (w.devices.topMaker) {
    const [maker, n] = w.devices.topMaker;
    const share = n / w.devices.count;
    s.push({
      key: "BRAND",
      ghost: maker.toUpperCase(),
      html: `
        <div class="row">${tag("04 / TOP BRAND")}${glyph("quad")}</div>
        <p class="lead">Most-installed manufacturer</p>
        <div class="name xl">${esc(maker)}</div>
        ${pips(share)}
        <p class="mono sm"><span class="blue">${Math.round(share * 100)}%</span> OF NEW DEVICES · ${n}/${w.devices.count}</p>
        ${spec([
          ["MANUFACTURERS", `${w.devices.makers}`],
          w.devices.room && ["MOST LOVED ROOM", esc(w.devices.room[0]), true],
          w.devices.room && ["NEW DEVICES THERE", `${w.devices.room[1]}`],
        ])}`,
    });
  }

  if (w.apps.count) {
    s.push({
      key: "APPS",
      ghost: "APPS",
      html: `
        <div class="row">${tag("05 / APPS")}${glyph("grid")}</div>
        <p class="lead">Apps installed on your server</p>
        <div class="big"><span data-count="${w.apps.count}">0</span><sup>APP</sup></div>
        <div class="chips">${w.apps.names.map((a, i) => `<span style="--i:${i}"><em>${pad(i + 1)}</em>${esc(a)}</span>`).join("")}
          ${w.apps.count > w.apps.names.length ? `<span class="more">+${w.apps.count - w.apps.names.length}</span>` : ""}</div>`,
    });
  }

  if (w.habits.total) {
    const h = w.habits;
    const owl = h.nightPct >= 20;
    const weekend = !owl && h.weekendPct >= 40;
    const hours = h.byHour || Array(24).fill(0);
    s.push({
      key: "HABITS",
      ghost: owl ? "NIGHT" : weekend ? "WEEKEND" : "DAYTIME",
      html: `
        <div class="row">${tag("06 / HABITS")}${glyph(owl ? "moon" : weekend ? "house" : "sun")}</div>
        <p class="lead">Your tinkering style</p>
        <div class="name xl">${owl ? "Night Owl" : weekend ? "Weekend Warrior" : "Daytime Tinkerer"}</div>
        ${spec([
          ["AFTER 22:00", `${h.nightPct}%`],
          ["ON WEEKENDS", `${h.weekendPct}%`],
          ["FAVORITE DAY", esc((h.topDay || "–").toUpperCase())],
          ["PEAK HOUR", fmtHour(h.peakHour), true],
        ])}
        ${ticks(hours, hours.map((_, i) => (i % 6 === 0 ? pad(i) : "")), { caption: "SETUPS / HOUR OF DAY", titles: hours.map((_, i) => fmtHour(i)) })}`,
    });
  }

  if (w.statsPending) s.push(readingsSlide(w.year));

  if (w.energy) {
    const e = w.energy;
    s.push({
      key: "ENERGY",
      ghost: "kWh",
      html: `
        <div class="row">${tag("07 / ENERGY")}${glyph("bolt")}</div>
        <p class="lead">Used by your metered devices</p>
        <div class="big"><span data-count="${Math.round(e.total)}">0</span><sup>kWh</sup></div>
        ${spec([
          ["TOP CONSUMER", esc(e.top[0].name), true],
          ["ITS SHARE", `${Math.round((e.top[0].kwh / e.total) * 100)}% · ${num(e.top[0].kwh, 1)} kWh`],
          ["HUNGRIEST MONTH", MONTH3[e.peakMonth]],
          ["METERED DEVICES", `${e.count}`],
        ])}
        ${ticks(e.monthly, MON, { caption: "kWh / MONTH", dp: 1, unit: " kWh", titles: MONTH3 })}`,
    });
  }

  if (w.climate?.hottest) {
    const c = w.climate;
    const rooms = c.rooms.slice(0, 5);
    const lo = Math.floor(Math.min(...rooms.map((r) => r.min)) / 5) * 5;
    const hi = Math.ceil(Math.max(...rooms.map((r) => r.max)) / 5) * 5;
    s.push({
      key: "CLIMATE",
      ghost: `${Math.round(c.hottest.max)}°`,
      html: `
        <div class="row">${tag("08 / CLIMATE")}${glyph("thermo")}</div>
        <p class="lead">Warmest moment indoors</p>
        <div class="big"><span data-count="${c.hottest.max}" data-dp="1">0</span><sup>${c.unit}</sup></div>
        ${spec([
          ["WHERE", esc(c.hottest.room), true],
          c.outside && ["OUTSIDE PEAK", `${num(c.outside.max, 1)}${c.unit} · ${MONTH3[c.outside.month]}`],
          ["COOLEST ON AVERAGE", `${esc(c.coldest.room)} · ${num(c.coldest.mean, 1)}${c.unit}`],
        ])}
        <figure class="ranges">
          ${rooms.map((r) => rangeRow(r, lo, hi)).join("")}
          <figcaption><span>MIN — MEAN — MAX</span><span>${lo}–${hi}${c.unit}</span></figcaption>
        </figure>`,
    });
  }

  const n = w.now;
  s.push({
    key: "INVENTORY",
    ghost: "INVENTORY",
    html: `
      <div class="row">${tag("09 / INVENTORY")}${glyph("house")}</div>
      <p class="lead">Your home today</p>
      <div class="cells">
        ${[["grid", n.entities, "ENTITIES"], ["gear", n.automations, "AUTOMATIONS"], ["nodes", w.devices.total, "DEVICES"],
          ["sq2", n.areas, "AREAS"], ["wave", n.scripts + n.scenes, "SCRIPTS & SCENES"], ["person", n.people, "PEOPLE"]]
          .map(([g, v, l], i) => `<div style="--i:${i}">${glyph(g)}<b data-count="${v}">0</b><span>${l}</span></div>`).join("")}
      </div>`,
  });

  const arch = w.archetype;
  const archGlyph = { "The Maker": "wrench", "The Mesh Master": "nodes", "The Climate Commander": "thermo", "The DJ": "wave", "The Automator": "gear" }[arch.name] || "cross";
  s.push({
    key: "CLASS",
    ghost: arch.name.replace(/^The /, "").toUpperCase(),
    html: `
      <div class="row">${tag("10 / CLASSIFICATION")}${tag("VERIFIED", "blue")}</div>
      <div class="seal"><i></i>${glyph(archGlyph, "xl")}</div>
      <p class="mono sm dim">YOUR HOME PERSONALITY</p>
      <h1 class="title">${esc(arch.name)}</h1>
      <p class="sub">${esc(arch.line)}</p>
      ${barcode(arch.name, 60)}`,
  });

  const style = w.habits.nightPct >= 20 ? "NIGHT OWL" : w.habits.weekendPct >= 40 ? "WEEKEND" : "DAYTIME";
  s.push({
    key: "SUMMARY",
    ghost: "",
    html: `
      <div class="sticker">
        <div class="st-hd">${glyph("house", "st-logo")}<div><b>HOME ASSISTANT</b><span>WRAPPED · ${w.year}</span></div><em>©${w.year}</em></div>
        <div class="st-io">
          <div><span>INPUT</span><b>${w.integrations.count} INTEGRATIONS · ${w.devices.count} DEVICES</b></div>
          <div><span>OUTPUT</span><b>${n.automations} AUTOMATIONS</b></div>
        </div>
        <dl class="st-rows">
          <div><dt>CLASS</dt><dd class="blue">${esc(arch.name.toUpperCase())}</dd></div>
          <div><dt>TOP BRAND</dt><dd>${esc(w.devices.topMaker?.[0] || "–")}</dd></div>
          <div><dt>TOP INTEGRATION</dt><dd>${esc(w.devices.topDomains[0]?.[0] || "–")}</dd></div>
          ${w.energy ? `<div><dt>ENERGY TRACKED</dt><dd>${num(w.energy.total)} kWh</dd></div>` : ""}
          ${w.climate?.hottest ? `<div><dt>HOTTEST ROOM</dt><dd>${num(w.climate.hottest.max, 1)}${w.climate.unit}</dd></div>` : ""}
          <div><dt>TINKER STYLE</dt><dd>${style}</dd></div>
        </dl>
        <div class="st-marks">${["house", "sq2", "bolt", "quad", "ring", "checker"].map((g) => glyph(g)).join("")}</div>
        <div class="st-ft">${barcode(`${w.year}${arch.name}${w.devices.count}`, 70)}<span>MADE WITH HOME ASSISTANT</span></div>
      </div>
      <p class="mono sm dim center">SCREENSHOT TO SHARE ↗</p>`,
  });

  return s;
}

/* ---------------------------------------------------------------- story -- */

const STORY_CSS = `
:host { all: initial;
  --ha-blue: #18bcf2; --ha-black: #1d2126; --ha-grey: #6e7191; --ha-white: #f2f4f9;
  --ink: rgba(242,244,249,.92); --dim: rgba(242,244,249,.55); --faint: rgba(242,244,249,.14); --hair: rgba(242,244,249,.22);
  --sans: Figtree, "Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace; }
.wrap { position: fixed; inset: 0; z-index: 10000; background: #121519; display: flex; align-items: center; justify-content: center;
  font-family: var(--sans); color: var(--ink); -webkit-font-smoothing: antialiased; animation: fadeIn .3s ease; }
.stage { position: relative; width: min(100vw, calc(100vh * 9 / 16)); height: min(100vh, calc(100vw * 16 / 9)); overflow: hidden;
  background: var(--ha-black); container-type: size; }
@media (min-width: 700px) { .stage { height: min(92vh, 860px); width: calc(min(92vh, 860px) * 9 / 16); border-radius: 18px;
  box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(242,244,249,.06); } }
/* paper grain */
.stage::after { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 3; opacity: .09; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }

/* drafting sheets */
.sheets { position: absolute; inset: 0; overflow: hidden; }
.sheet { position: absolute; inset: -7%; transform: translate(var(--tx), var(--ty)) rotate(var(--rot));
  background-color: rgba(242,244,249,.018); border: 1px solid rgba(242,244,249,.07);
  background-image: linear-gradient(rgba(242,244,249,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(242,244,249,.05) 1px, transparent 1px),
    linear-gradient(rgba(242,244,249,.022) 1px, transparent 1px), linear-gradient(90deg, rgba(242,244,249,.022) 1px, transparent 1px);
  background-size: 18cqw 18cqw, 18cqw 18cqw, 3.6cqw 3.6cqw, 3.6cqw 3.6cqw; animation: settle 1.2s cubic-bezier(.2,.8,.2,1) both; }
.sheet svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.sheet .ln { fill: none; stroke: rgba(242,244,249,.16); stroke-width: .18; }
.sheet .tx { fill: rgba(242,244,249,.14); }
.sheet .ghost { font: 900 30px var(--sans); fill: rgba(242,244,249,.07); letter-spacing: -1.5px; }
.s0 { filter: blur(.3px); opacity: .9; }
.s1 { filter: blur(1.4px); opacity: .7; }
.s2 { filter: blur(3.2px); opacity: .85; }
.sheet.blue .ln { stroke: rgba(24,188,242,.32); }
.sheet.blue { background-color: rgba(24,188,242,.025); }

/* chrome */
.progress { position: absolute; top: 12px; left: 16px; right: 16px; display: flex; gap: 3px; z-index: 5; }
.progress i { flex: 1; height: 2px; background: var(--faint); transition: background .3s; }
.progress i.done { background: var(--ha-white); }
.progress i.cur { background: var(--ha-blue); }
.close { position: absolute; top: 22px; right: 12px; z-index: 6; background: none; border: 0; color: var(--dim); cursor: pointer;
  font: 500 10px var(--mono); letter-spacing: .12em; padding: 6px; }
.close:hover { color: var(--ink); }
.tapL, .tapR { position: absolute; top: 44px; bottom: 0; z-index: 4; cursor: pointer; }
.tapL { left: 0; width: 30%; } .tapR { right: 0; width: 70%; }

.slide { position: absolute; inset: 0; animation: slideIn .45s cubic-bezier(.2,.8,.2,1); }
.content { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; padding: 30px 6.5cqw 16px; box-sizing: border-box; }
.hd, .ft { display: flex; align-items: center; gap: 8px; font: 500 9.5px var(--mono); letter-spacing: .12em; color: var(--dim); text-transform: uppercase; }
.hd .rule, .ft .rule { flex: 1; height: 1px; background: var(--hair); }
.hd { padding-right: 52px; }
.ft { margin-top: 10px; }
.ft .g { width: 14px; height: 14px; color: var(--dim); }
.body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 1.6cqh; min-height: 0; }
.body > * { animation: rise .55s cubic-bezier(.2,.8,.2,1) both; }
.body > *:nth-child(2) { animation-delay: .06s } .body > *:nth-child(3) { animation-delay: .12s }
.body > *:nth-child(4) { animation-delay: .18s } .body > *:nth-child(5) { animation-delay: .24s }
.body > *:nth-child(n+6) { animation-delay: .3s }

/* type */
.mono { font-family: var(--mono); letter-spacing: .1em; text-transform: uppercase; }
.sm { font-size: 10px; margin: 0; }
.dim { color: var(--dim); }
.blue { color: var(--ha-blue); }
.center { text-align: center; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.row .g { width: 22px; height: 22px; color: var(--ha-blue); }
.tag { font: 500 10px var(--mono); letter-spacing: .12em; color: var(--ink); white-space: nowrap; }
.tag.blue { color: var(--ha-blue); }
.lead { margin: 1cqh 0 0; font: 500 4.6cqw/1.2 var(--sans); color: var(--dim); }
.hero { margin: 0; font: 900 21cqw/.85 var(--sans); letter-spacing: -.055em; color: var(--ha-white); }
.yr { display: flex; align-items: center; justify-content: space-between; font: 700 15cqw/1 var(--mono); letter-spacing: -.02em;
  color: transparent; -webkit-text-stroke: 1px var(--ha-blue); }
.yr .g.lg { width: 13cqw; height: 13cqw; color: var(--ha-blue); stroke-width: .9; }
.big { display: flex; align-items: flex-start; gap: 2cqw; font: 800 27cqw/.9 var(--sans); letter-spacing: -.05em; color: var(--ha-white);
  font-variant-numeric: tabular-nums; }
.big sup { font: 500 10px var(--mono); letter-spacing: .12em; color: var(--ha-blue); margin-top: 2.4cqw; border: 1px solid var(--ha-blue); padding: 3px 5px; }
.name { font: 800 10.5cqw/1 var(--sans); letter-spacing: -.035em; color: var(--ha-white); }
.name.sm { font-size: 7.5cqw; }
.name.xl { font-size: 13cqw; line-height: .95; }
.title { margin: 0; font: 900 12cqw/.95 var(--sans); letter-spacing: -.04em; color: var(--ha-white); }
.sub { margin: 0; font: 400 4cqw/1.45 "Instrument Sans", var(--sans); color: var(--dim); }
.hint { margin-top: 1cqh; font-size: 10.5px; color: var(--ha-blue); animation: pulse 1.8s ease-in-out infinite !important; }

/* spec block */
.spec { margin: 0; border-top: 1px solid var(--hair); }
.spec div { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--hair); }
.spec dt { font: 500 9.5px var(--mono); letter-spacing: .12em; color: var(--dim); white-space: nowrap; }
.spec dd { margin: 0; font: 600 12.5px var(--mono); letter-spacing: .04em; color: var(--ink); text-align: right; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spec .hi dd { color: var(--ha-blue); }
.spec .hi dt::before { content: "▸ "; color: var(--ha-blue); }

/* marks */
.g { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: square; flex: none; }
.marks { display: flex; gap: 10px; color: var(--dim); }
.marks .g:first-child { color: var(--ha-blue); }

/* histogram */
.ticks { margin: 0; }
.tk-plot { position: relative; height: 15cqh; display: flex; align-items: flex-end; gap: 2px; padding-top: 6px;
  border-bottom: 1px solid var(--hair);
  background: repeating-linear-gradient(to top, transparent 0 calc(25% - 1px), rgba(242,244,249,.06) calc(25% - 1px) 25%); }
/* each bar is a thin stem with a cap tick, like a reading on an instrument */
.tk-plot i { position: relative; flex: 1; height: var(--h); transform-origin: bottom;
  animation: grow .6s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(.3s + var(--i) * .025s); }
.tk-plot i::before { content: ""; position: absolute; left: 32%; right: 32%; top: 0; bottom: 0; background: rgba(242,244,249,.34); }
.tk-plot i::after { content: ""; position: absolute; left: 8%; right: 8%; top: 0; height: 1px; background: rgba(242,244,249,.7); }
.tk-plot i.hi::before { background: var(--ha-blue); box-shadow: 0 0 10px rgba(24,188,242,.5); }
.tk-plot i.hi::after { background: var(--ha-blue); }
.tk-axis { display: flex; gap: 2px; margin-top: 4px; }
.tk-axis span { flex: 1; text-align: center; font: 500 8.5px var(--mono); color: var(--dim); }
.tk-axis span.hi { color: var(--ha-blue); }
.ticks figcaption, .ranges figcaption { display: flex; justify-content: space-between; margin-top: 6px;
  font: 500 8.5px var(--mono); letter-spacing: .12em; color: var(--dim); }

/* ranking */
.rank { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--hair); }
.rank li { display: grid; grid-template-columns: 22px 1fr auto; column-gap: 8px; align-items: baseline; padding: 7px 0 6px;
  border-bottom: 1px solid var(--hair); animation: rise .45s both; animation-delay: calc(.3s + var(--i) * .06s); }
.rank .idx { font: 500 9.5px var(--mono); color: var(--ha-blue); }
.rank .lbl { font: 600 4cqw/1.2 var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank b { font: 700 13px var(--mono); }
.rank .bar { grid-column: 2 / 4; height: 2px; margin-top: 5px; background: var(--faint); }
.rank .bar i { display: block; height: 100%; width: var(--w); background: var(--ha-blue); transform-origin: left; animation: growX .8s both .5s; }

/* proportion */
.pips { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; }
.pips i { aspect-ratio: 1 / 2.4; border: 1px solid var(--hair); animation: rise .4s both; animation-delay: calc(.3s + var(--i) * .02s); }
.pips i.on { background: var(--ha-blue); border-color: var(--ha-blue); }

/* chips */
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips span { display: inline-flex; gap: 7px; align-items: center; border: 1px solid var(--hair); padding: 6px 9px;
  font: 500 10.5px var(--mono); letter-spacing: .06em; text-transform: uppercase; animation: rise .4s both; animation-delay: calc(.3s + var(--i) * .05s); }
.chips em { font-style: normal; color: var(--ha-blue); }
.chips .more { color: var(--ha-blue); border-color: var(--ha-blue); }

/* label stickers */
.label { border: 1px solid var(--hair); padding: 10px 12px; background: rgba(29,33,38,.55); backdrop-filter: blur(2px); }
.label.hi { border-color: var(--ha-blue); }
.label-hd { display: flex; justify-content: space-between; font: 500 9.5px var(--mono); letter-spacing: .12em; color: var(--dim); margin-bottom: 8px; }
.label.hi .label-hd span:first-child { color: var(--ha-blue); }
.label-ft { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-top: 8px; }
.label-ft .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.barcode { width: 30%; min-width: 70px; height: 18px; fill: var(--ink); flex: none; }
.leader { display: flex; align-items: center; gap: 8px; color: var(--ha-blue); }
.leader span { flex: 1; height: 0; border-top: 1px dashed rgba(24,188,242,.6); }

/* climate ranges */
.ranges { margin: 0; border-top: 1px solid var(--hair); }
.rng { display: grid; grid-template-columns: 30% 1fr 42px; gap: 10px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--hair); }
.rng-l { font: 600 3.6cqw var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rng-t { position: relative; height: 10px;
  background: repeating-linear-gradient(90deg, rgba(242,244,249,.22) 0 1px, transparent 1px 10%) center / 100% 4px no-repeat; }
.rng-t i { position: absolute; top: 3px; height: 4px; background: rgba(242,244,249,.4); }
.rng-t b { position: absolute; top: 0; width: 2px; height: 10px; margin-left: -1px; background: var(--ha-blue); }
.rng-v { font: 600 12px var(--mono); text-align: right; }

/* inventory cells */
.cells { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--hair); border-left: 1px solid var(--hair); }
.cells div { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 12px; border-right: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair); animation: rise .45s both; animation-delay: calc(.3s + var(--i) * .05s); }
.cells .g { position: absolute; top: 10px; right: 10px; width: 16px; height: 16px; color: var(--ha-blue); }
.cells b { font: 800 10cqw/1 var(--sans); letter-spacing: -.03em; color: var(--ha-white); font-variant-numeric: tabular-nums; }
.cells span { font: 500 9px var(--mono); letter-spacing: .12em; color: var(--dim); }

/* classification */
.seal { position: relative; width: 34cqw; height: 34cqw; border: 1px solid var(--ha-blue); border-radius: 50%; display: grid; place-items: center; }
.seal::before, .seal::after { content: ""; position: absolute; background: rgba(24,188,242,.5); }
.seal::before { left: -5cqw; right: -5cqw; top: 50%; height: 1px; }
.seal::after { top: -5cqw; bottom: -5cqw; left: 50%; width: 1px; }
.seal { background: radial-gradient(circle, var(--ha-black) 0 30%, transparent 31%); }
.seal::before, .seal::after { z-index: 0; }
.seal .g.xl { width: 15cqw; height: 15cqw; color: var(--ha-white); stroke-width: 1.1; position: relative; z-index: 1;
  filter: drop-shadow(0 0 4px var(--ha-black)); }
.seal i { position: absolute; inset: 9%; border: 1px dashed rgba(24,188,242,.45); border-radius: 50%; }
.body > .barcode { width: 100%; height: 22px; opacity: .8; }

/* pending readings */
.scan { position: relative; height: 15cqh; border: 1px solid var(--hair); overflow: hidden;
  background: repeating-linear-gradient(90deg, rgba(242,244,249,.07) 0 1px, transparent 1px 8.33%),
    repeating-linear-gradient(to top, rgba(242,244,249,.05) 0 1px, transparent 1px 25%); }
.scan i { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: var(--ha-blue);
  box-shadow: 0 0 12px 2px rgba(24,188,242,.5); animation: sweep 1.8s cubic-bezier(.6,0,.4,1) infinite alternate; }
.scan::after { content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(24,188,242,.08) 50%, transparent); animation: sweepGlow 1.8s ease-in-out infinite alternate; }
.blink { animation: pulse 1.2s steps(2, jump-none) infinite; }

/* summary sticker */
.sticker { border: 1px solid var(--ha-white); background: rgba(29,33,38,.82); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.st-hd { display: flex; align-items: center; gap: 10px; }
.st-hd .st-logo { width: 30px; height: 30px; color: var(--ha-blue); stroke-width: 1.6; }
.st-hd div { display: flex; flex-direction: column; flex: 1; }
.st-hd b { font: 800 5.4cqw/1 var(--sans); letter-spacing: -.01em; color: var(--ha-white); }
.st-hd span { font: 500 9.5px var(--mono); letter-spacing: .14em; color: var(--ha-blue); margin-top: 3px; }
.st-hd em { font: 500 10px var(--mono); font-style: normal; color: var(--dim); align-self: flex-start; }
.st-io { border: 1px solid var(--hair); background: rgba(242,244,249,.06); }
.st-io div { display: flex; gap: 10px; padding: 6px 8px; font: 500 10px var(--mono); letter-spacing: .06em; }
.st-io div + div { border-top: 1px solid var(--hair); }
.st-io span { color: var(--dim); width: 52px; flex: none; }
.st-io b { font-weight: 600; color: var(--ink); }
.st-rows { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 9px 12px; }
.st-rows div { min-width: 0; }
.st-rows dt { font: 500 8.5px var(--mono); letter-spacing: .12em; color: var(--dim); }
.st-rows dd { margin: 2px 0 0; font: 700 4.2cqw/1.15 var(--sans); color: var(--ha-white); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-rows dd.blue { color: var(--ha-blue); }
.st-marks { display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); color: var(--ink); }
.st-ft { display: flex; flex-direction: column; gap: 5px; }
.st-ft .barcode { width: 100%; height: 26px; }
.st-ft span { font: 500 8.5px var(--mono); letter-spacing: .16em; color: var(--dim); text-align: center; }

@keyframes fadeIn { from { opacity: 0 } }
@keyframes slideIn { from { opacity: 0 } }
@keyframes settle { from { opacity: 0; transform: translate(var(--tx), calc(var(--ty) + 2%)) rotate(calc(var(--rot) * 1.6)); } }
@keyframes rise { from { opacity: 0; transform: translateY(10px) } }
@keyframes grow { from { transform: scaleY(0) } }
@keyframes growX { from { transform: scaleX(0) } }
@keyframes pulse { 50% { opacity: .35 } }
@keyframes sweep { to { left: calc(100% - 1px); } }
@keyframes sweepGlow { from { transform: translateX(-50%); } to { transform: translateX(50%); } }
@media (prefers-reduced-motion: reduce) { .sheet, .slide, .body > *, .tk-plot i, .rank li, .rank .bar i, .pips i, .chips span, .cells div,
  .scan i, .scan::after { animation: none !important; } }
`;

class HaWrappedStory extends HTMLElement {
  open(slides, year) {
    this.slides = slides;
    this.year = year;
    this.idx = 0;
    this.final = false; // more slides may still arrive
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STORY_CSS}</style>
      <div class="wrap"><div class="stage">
        <div class="progress">${slides.map(() => "<i></i>").join("")}</div>
        <button class="close" aria-label="Close">ESC ×</button>
        <div class="holder"></div>
        <div class="tapL"></div><div class="tapR"></div>
      </div></div>`;
    this.holder = root.querySelector(".holder");
    root.querySelector(".close").onclick = () => this.close();
    root.querySelector(".tapL").onclick = () => this.go(this.idx - 1);
    root.querySelector(".tapR").onclick = () => this.go(this.idx + 1);
    this._key = (e) => {
      if (e.key === "Escape") this.close();
      else if (e.key === "ArrowRight" || e.key === " ") this.go(this.idx + 1);
      else if (e.key === "ArrowLeft") this.go(this.idx - 1);
    };
    window.addEventListener("keydown", this._key);
    this.show();
  }
  // Swap in a newer deck while the viewer is browsing. Slides arrive in two
  // steps (the quick ones, then energy and climate), so keep the viewer on the
  // same slide by its key and only redraw it when its content changed.
  setSlides(slides, final = true) {
    const cur = this.slides[this.idx];
    this.slides = slides;
    this.final = final;
    this.shadowRoot.querySelector(".progress").innerHTML = slides.map(() => "<i></i>").join("");
    let i = slides.findIndex((x) => x.key === cur.key);
    // The slide on screen was a stand-in that's now gone: show what replaced it
    const replaced = i < 0;
    if (replaced) i = Math.min(this.idx, slides.length - 1);
    this.idx = i;
    if (replaced || (cur.key !== "INTRO" && slides[i].html !== cur.html)) {
      this.show();
    } else {
      const hint = this.holder.querySelector(".hint");
      if (hint && cur.key === "INTRO") hint.textContent = "TAP TO BEGIN →";
      const no = this.holder.querySelector(".sheetno");
      if (no) no.textContent = this.sheetNo();
      this.updateProgress();
    }
    // A tap past the end that came in while loading moves on now
    if (this._wantNext) { this._wantNext = false; this.go(this.idx + 1); }
  }
  // Slides only change on tap, click or arrow key; there is no auto-advance.
  go(i) {
    if (i < 0) i = 0;
    if (i >= this.slides.length) { this._wantNext = !this.final; return; } // still loading, or on summary
    this.idx = i;
    this.show();
  }
  sheetNo() { return `SHEET ${pad(this.idx + 1)}/${this.final ? pad(this.slides.length) : "··"}`; }
  updateProgress() {
    this.shadowRoot.querySelectorAll(".progress i").forEach((el, i) => {
      el.className = i < this.idx ? "done" : i === this.idx ? "cur" : "";
    });
  }
  show() {
    const s = this.slides[this.idx];
    const yy = String(this.year).slice(-2);
    this.holder.innerHTML = `<section class="slide">
      ${sheets(this.idx + 1, s.ghost)}
      <div class="content">
        <header class="hd"><span>HA/WRAPPED</span><span class="rule"></span><span class="sheetno">${this.sheetNo()}</span></header>
        <div class="body">${s.html}</div>
        <footer class="ft"><span>DWG HA-${yy}-${pad(this.idx + 1)}</span><span class="rule"></span><span>${esc(s.key)}</span>${glyph("cross")}</footer>
      </div>
    </section>`;
    this.updateProgress();
    this.countUp();
  }
  countUp() {
    this.holder.querySelectorAll("[data-count]").forEach((el) => {
      const to = parseFloat(el.dataset.count);
      const dp = +(el.dataset.dp || 0);
      const t0 = performance.now();
      const D = 1200;
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / D);
        const v = to * (1 - Math.pow(1 - p, 3));
        el.textContent = num(v, dp);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(() => { el.textContent = num(to, dp); }, D + 150); // in case rAF is throttled
    });
  }
  close() {
    window.removeEventListener("keydown", this._key);
    this.remove();
  }
}
if (!customElements.get("ha-wrapped-story")) customElements.define("ha-wrapped-story", HaWrappedStory);

/* ----------------------------------------------------------------- card -- */

class HaWrappedCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this.year = +(this.config.year || new Date().getFullYear());
  }
  set hass(hass) {
    this._hass = hass;
    if (!this.rendered) {
      this.render();
      this.prefetch().catch(() => {}); // warm up in the background; errors surface on play
    }
  }
  getCardSize() { return 3; }
  static getStubConfig() { return {}; }

  // Data is gathered once per browser and cached for a few hours, so only the
  // very first run waits on the recorder. It arrives in two steps: `_core`
  // (registries, quick) and `_full` (plus a year of statistics, slow).
  prefetch() {
    if (this._full) return this._full;
    const key = `ha-wrapped:v2:${this.year}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.at < CACHE_MS) {
        this._core = this._full = Promise.resolve(cached.data);
        return this._full;
      }
    } catch (_) { /* storage unavailable */ }
    let coreReady;
    this._core = new Promise((res) => { coreReady = res; });
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
    this._full = new Promise((res) => idle(res, { timeout: 2000 }))
      .then(() => collectWrapped(this._hass, this.year, coreReady))
      .then((data) => {
        try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (_) { /* full or blocked */ }
        return data;
      });
    this._full.catch(() => { this._full = this._core = null; }); // allow retry
    return this._full;
  }

  render() {
    this.rendered = true;
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { --ha-blue: #18bcf2; --ha-black: #1d2126; --ha-white: #f2f4f9; --dim: rgba(242,244,249,.55); --hair: rgba(242,244,249,.2);
          --sans: Figtree, "Instrument Sans", system-ui, sans-serif; --mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace; }
        ha-card { position: relative; display: block; overflow: hidden; cursor: pointer; color: var(--ha-white); background-color: var(--ha-black);
          border-radius: var(--ha-card-border-radius, 12px); font-family: var(--sans);
          background-image: linear-gradient(rgba(242,244,249,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(242,244,249,.05) 1px, transparent 1px),
            linear-gradient(rgba(242,244,249,.02) 1px, transparent 1px), linear-gradient(90deg, rgba(242,244,249,.02) 1px, transparent 1px);
          background-size: 80px 80px, 80px 80px, 16px 16px, 16px 16px; }
        .in { position: relative; padding: 16px 18px 14px; display: flex; flex-direction: column; gap: 10px; }
        .top, .bottom { display: flex; align-items: center; justify-content: space-between; gap: 12px;
          font: 500 10px var(--mono); letter-spacing: .12em; color: var(--dim); }
        .top .rule { flex: 1; height: 1px; background: var(--hair); }
        .top .ref { color: var(--ha-blue); }
        .h { display: flex; align-items: baseline; gap: 12px; font: 900 40px/.9 var(--sans); letter-spacing: -.05em; }
        .h .yr { font: 700 26px var(--mono); letter-spacing: -.02em; color: transparent; -webkit-text-stroke: 1px var(--ha-blue); }
        .s { font: 500 10px var(--mono); letter-spacing: .12em; color: var(--dim); }
        .bar { flex: 1; height: 18px; fill: var(--ha-white); opacity: .7; }
        button { all: unset; flex: none; font: 600 11px var(--mono); letter-spacing: .14em; color: var(--ha-black); background: var(--ha-blue);
          padding: 8px 12px; transition: transform .15s; }
        ha-card:hover button { transform: translateX(2px); }
        .err { color: #ffb4a8; font: 500 11px var(--mono); }
      </style>
      <ha-card><div class="in">
        <div class="top"><span>[ HA/WRAPPED ]</span><span class="rule"></span><span class="ref">REF.${this.year}</span></div>
        <div class="h">Wrapped <span class="yr">${this.year}</span></div>
        <div class="s">YOUR YEAR IN SMART HOME — TAP THROUGH</div>
        <div class="err" hidden></div>
        <div class="bottom">${barcode(`wrapped${this.year}`, 60).replace('class="barcode"', 'class="bar"')}<button aria-label="Play">▶ PLAY</button></div>
      </div></ha-card>`;
    root.querySelector("ha-card").addEventListener("click", () => this.play());
  }

  async play() {
    const err = this.shadowRoot.querySelector(".err");
    err.hidden = true;
    // Open straight away on the intro; the rest of the deck slots in when ready.
    const story = document.createElement("ha-wrapped-story");
    document.body.appendChild(story);
    story.open([introSlide(this.year, true)], this.year);
    try {
      const full = this.prefetch();
      // Show the quick slides first; energy and climate slot in when ready
      const core = await Promise.race([this._core, full]);
      if (story.isConnected) story.setSlides(buildSlides(core), !core.statsPending);
      if (core.statsPending) {
        const data = await full;
        if (story.isConnected) story.setSlides(buildSlides(data), true);
      }
    } catch (e) {
      console.error("ha-wrapped", e);
      story.close();
      err.textContent = `Couldn't build your Wrapped: ${e.message || e.code || e}. (Admin user required.)`;
      err.hidden = false;
    }
  }
}
if (!customElements.get("ha-wrapped-card")) customElements.define("ha-wrapped-card", HaWrappedCard);

window.customCards = window.customCards || [];
window.customCards.push({ type: "ha-wrapped-card", name: "Home Assistant Wrapped", description: "A tap-through year-in-review story for your smart home." });
