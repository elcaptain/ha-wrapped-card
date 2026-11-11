/**
 * Home Assistant Wrapped — a year-in-review story for your smart home.
 *
 * Install: copy to /config/www/ha-wrapped-card.js, add as a dashboard resource
 * (/local/ha-wrapped-card.js, type: module), then add a card:
 *   type: custom:ha-wrapped-card
 *   year: 2026   # optional, defaults to the current year
 *
 * Needs an admin user (registry + recorder websocket commands).
 */

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

async function collectWrapped(hass, year) {
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

  // Everything that doesn't depend on something else goes out in one round trip.
  const [entries, devices, entities, areas, manifests, statIdsAll] = await Promise.all([
    hass.callWS({ type: "config_entries/get" }),
    hass.callWS({ type: "config/device_registry/list" }),
    hass.callWS({ type: "config/entity_registry/list" }),
    hass.callWS({ type: "config/area_registry/list" }),
    hass.callWS({ type: "manifest/list" }).catch(() => []), // loaded integrations' names
    hass.callWS({ type: "recorder/list_statistic_ids" }).catch((e) => { console.warn("ha-wrapped: statistics unavailable", e); return []; }),
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

  let energy = null;
  let climate = null;
  try {
    const statIds = statIdsAll;
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

  return {
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
      topDay: byDay[0]?.[0], peakHour,
    },
    energy, climate, now,
    archetype: archetypes[0],
  };
}

/* -------------------------------------------------------------- helpers -- */

const fmtDate = (ts, tz) => new Date(ts * 1000).toLocaleDateString("en-US", { timeZone: tz, month: "long", day: "numeric" });
const fmtHour = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n, d = 0) => Number(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

function bars(values, labels, opts = {}) {
  const max = Math.max(...values, 1);
  const hi = opts.highlight ?? values.indexOf(max);
  return `<div class="bars">${values.map((v, i) => `
    <div class="bar ${i === hi ? "hi" : ""}" title="${esc(labels[i])}: ${num(v, opts.dp || 0)}">
      <span style="--h:${Math.max(4, (v / max) * 100)}%;--i:${i}"></span>
      <em>${esc(labels[i]).slice(0, opts.cut || 1)}</em>
    </div>`).join("")}</div>`;
}

/* --------------------------------------------------------------- slides -- */

function introSlide(year, loading = false) {
  return {
    theme: "intro",
    html: `
      <div class="kicker">Home Assistant</div>
      <h1 class="mega">Your<br>${year}<br><span class="grad">Wrapped</span></h1>
      <p class="sub">A year of tinkering, automating and making your home a little smarter.</p>
      <div class="hint">${loading ? "Gathering your year…" : "Tap to begin →"}</div>`,
  };
}

function buildSlides(w) {
  const s = [];
  const tz = w.tz;

  s.push(introSlide(w.year));

  if (w.integrations.count) {
    s.push({
      theme: "violet",
      html: `
        <div class="kicker">Integrations</div>
        <p class="lead">This year you connected</p>
        <div class="big"><span data-count="${w.integrations.count}">0</span></div>
        <p class="lead">integrations to your home</p>
        <p class="sub">That's <b>${w.integrations.domains}</b> brand-new kinds of things Home Assistant learned to talk to${w.integrations.helpers ? `, plus <b>${w.integrations.helpers}</b> helpers you built yourself` : ""}.</p>
        ${bars(w.integrations.byMonth, MONTHS)}
        <p class="foot">Busiest month: <b>${MONTHS[w.integrations.byMonth.indexOf(Math.max(...w.integrations.byMonth))]}</b></p>`,
    });
  }

  if (w.integrations.first) {
    s.push({
      theme: "teal",
      html: `
        <div class="kicker">Where it started</div>
        <p class="lead">On <b>${fmtDate(w.integrations.first.date, tz)}</b>, your first new integration was</p>
        <div class="name">${esc(w.integrations.first.name)}</div>
        <div class="divider"></div>
        <p class="lead">And most recently, on ${fmtDate(w.integrations.latest.date, tz)}:</p>
        <div class="name small">${esc(w.integrations.latest.name)}</div>
        <p class="sub">${esc(w.integrations.latest.title)}</p>`,
    });
  }

  if (w.devices.count) {
    const top = w.devices.topDomains;
    const max = top[0]?.[1] || 1;
    s.push({
      theme: "blue",
      html: `
        <div class="kicker">Devices</div>
        <p class="lead">You welcomed</p>
        <div class="big"><span data-count="${w.devices.count}">0</span></div>
        <p class="lead">new devices into your home</p>
        <ol class="rank">${top.map(([n, c], i) => `
          <li style="--i:${i}"><span class="pos">${i + 1}</span><span class="lbl">${esc(n)}</span>
          <span class="meter"><i style="--w:${(c / max) * 100}%"></i></span><b>${c}</b></li>`).join("")}
        </ol>`,
    });
  }

  if (w.devices.topMaker) {
    s.push({
      theme: "orange",
      html: `
        <div class="kicker">Your top brand</div>
        <p class="lead">Out of <b>${w.devices.makers}</b> manufacturers, your favorite was</p>
        <div class="name">${esc(w.devices.topMaker[0])}</div>
        <p class="sub"><b>${w.devices.topMaker[1]}</b> new devices. That's ${Math.round((w.devices.topMaker[1] / w.devices.count) * 100)}% of everything you added.</p>
        ${w.devices.room ? `<div class="divider"></div><p class="lead">The room that got the most love:</p><div class="name small">${esc(w.devices.room[0])}</div><p class="sub">${w.devices.room[1]} new devices</p>` : ""}`,
    });
  }

  if (w.apps.count) {
    s.push({
      theme: "pink",
      html: `
        <div class="kicker">Apps</div>
        <p class="lead">You installed</p>
        <div class="big"><span data-count="${w.apps.count}">0</span></div>
        <p class="lead">apps on your server</p>
        <div class="chips">${w.apps.names.map((n, i) => `<span style="--i:${i}">${esc(n)}</span>`).join("")}</div>`,
    });
  }

  if (w.habits.total) {
    const owl = w.habits.nightPct >= 20;
    s.push({
      theme: "night",
      html: `
        <div class="kicker">Your tinkering habits</div>
        <div class="emoji">${owl ? "🦉" : w.habits.weekendPct >= 40 ? "🛋️" : "☕"}</div>
        <h2>${owl ? "Night Owl" : w.habits.weekendPct >= 40 ? "Weekend Warrior" : "Daytime Tinkerer"}</h2>
        <p class="sub"><b>${w.habits.nightPct}%</b> of your setups happened after 10 PM, and <b>${w.habits.weekendPct}%</b> on weekends.</p>
        <p class="sub">Favorite day: <b>${w.habits.topDay}</b>. Peak hour: <b>${fmtHour(w.habits.peakHour)}</b>.</p>
        ${bars(w.habits.byMonth, MONTHS)}
        <p class="foot">Everything you set up, month by month</p>`,
    });
  }

  if (w.energy) {
    const e = w.energy;
    s.push({
      theme: "green",
      html: `
        <div class="kicker">Energy</div>
        <p class="lead">Your tracked devices used</p>
        <div class="big"><span data-count="${Math.round(e.total)}">0</span><small> kWh</small></div>
        <p class="sub">Your hardest worker: <b>${esc(e.top[0].name)}</b> with ${num(e.top[0].kwh, 1)} kWh (${Math.round((e.top[0].kwh / e.total) * 100)}% of the total).</p>
        ${bars(e.monthly, MONTHS, { dp: 1 })}
        <p class="foot">Hungriest month: <b>${MONTHS[e.peakMonth]}</b> · ${e.count} metered device${e.count === 1 ? "" : "s"}</p>`,
    });
  }

  if (w.climate?.hottest) {
    const c = w.climate;
    s.push({
      theme: "heat",
      html: `
        <div class="kicker">Climate</div>
        <p class="lead">Your warmest moment indoors</p>
        <div class="big"><span data-count="${c.hottest.max}" data-dp="1">0</span><small>${c.unit}</small></div>
        <p class="sub">in the <b>${esc(c.hottest.room)}</b>${c.outside ? `, while it hit <b>${num(c.outside.max, 1)}${c.unit}</b> outside in ${MONTHS[c.outside.month]}` : ""}.</p>
        <div class="divider"></div>
        <p class="sub">Coolest room on average: <b>${esc(c.coldest.room)}</b> at ${num(c.coldest.mean, 1)}${c.unit}.</p>
        <div class="temps">${c.rooms.slice(0, 5).map((r, i) => `
          <div style="--i:${i}"><span>${esc(r.room)}</span><b>${num(r.mean, 1)}°</b></div>`).join("")}</div>
        <p class="foot">Average temperature by room</p>`,
    });
  }

  s.push({
    theme: "violet",
    html: `
      <div class="kicker">Your home today</div>
      <div class="grid">
        <div><b data-count="${w.now.entities}">0</b><span>entities</span></div>
        <div><b data-count="${w.now.automations}">0</b><span>automations</span></div>
        <div><b data-count="${w.devices.total}">0</b><span>devices</span></div>
        <div><b data-count="${w.now.areas}">0</b><span>areas</span></div>
        <div><b data-count="${w.now.scripts + w.now.scenes}">0</b><span>scripts &amp; scenes</span></div>
        <div><b data-count="${w.now.people}">0</b><span>people at home</span></div>
      </div>`,
  });

  s.push({
    theme: "intro",
    html: `
      <div class="kicker">Your home personality</div>
      <div class="emoji xl">${w.archetype.emoji}</div>
      <h1 class="title"><span class="grad">${esc(w.archetype.name)}</span></h1>
      <p class="sub">${esc(w.archetype.line)}</p>`,
  });

  // Shareable summary
  s.push({
    theme: "summary",
    html: `
      <div class="card-sum">
        <div class="sum-head"><span class="logo">⌂</span> My ${w.year} Home Wrapped</div>
        <div class="sum-arch">${w.archetype.emoji} ${esc(w.archetype.name)}</div>
        <div class="sum-grid">
          <div><span>Integrations added</span><b>${w.integrations.count}</b></div>
          <div><span>New devices</span><b>${w.devices.count}</b></div>
          <div><span>Top brand</span><b>${esc(w.devices.topMaker?.[0] || "–")}</b></div>
          <div><span>Automations</span><b>${w.now.automations}</b></div>
          ${w.energy ? `<div><span>Energy tracked</span><b>${num(w.energy.total)} kWh</b></div>` : ""}
          ${w.climate?.hottest ? `<div><span>Hottest room</span><b>${num(w.climate.hottest.max, 1)}°</b></div>` : ""}
          <div><span>Top integration</span><b>${esc(w.devices.topDomains[0]?.[0] || "–")}</b></div>
          <div><span>Tinker style</span><b>${w.habits.nightPct >= 20 ? "Night Owl" : w.habits.weekendPct >= 40 ? "Weekend" : "Daytime"}</b></div>
        </div>
        <div class="sum-foot">Made with Home Assistant</div>
      </div>
      <p class="foot">Take a screenshot to share it 📸</p>`,
  });

  return s;
}

/* ---------------------------------------------------------------- story -- */

const STORY_CSS = `
:host { all: initial; }
.wrap { position: fixed; inset: 0; z-index: 10000; background: #000; display: flex; align-items: center; justify-content: center;
  font-family: "Figtree", "Roboto", system-ui, -apple-system, sans-serif; color: #fff; -webkit-font-smoothing: antialiased; animation: fadeIn .3s ease; }
.stage { position: relative; width: min(100vw, calc(100vh * 9 / 16)); height: min(100vh, calc(100vw * 16 / 9)); max-height: 100vh;
  overflow: hidden; border-radius: 0; }
@media (min-width: 700px) { .stage { height: min(92vh, 860px); width: calc(min(92vh, 860px) * 9 / 16); border-radius: 24px; box-shadow: 0 30px 80px rgba(0,0,0,.6); } }
.progress { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; gap: 4px; z-index: 5; }
.progress i { flex: 1; height: 3px; border-radius: 3px; background: rgba(255,255,255,.3); overflow: hidden; }
.progress i b { display: block; height: 100%; width: 0; background: #fff; }
.progress i.done b { width: 100%; }
.progress i.cur b { animation: fill var(--dur) linear forwards; }
.paused .progress i.cur b { animation-play-state: paused; }
.close { position: absolute; top: 24px; right: 14px; z-index: 6; background: none; border: 0; color: #fff; font-size: 28px; cursor: pointer; opacity: .8; padding: 4px 8px; }
.tapL, .tapR { position: absolute; top: 0; bottom: 0; z-index: 4; cursor: pointer; }
.tapL { left: 0; width: 30%; } .tapR { right: 0; width: 70%; }
.slide { position: absolute; inset: 0; padding: 72px 28px 40px; display: flex; flex-direction: column; justify-content: center; gap: 6px;
  box-sizing: border-box; animation: slideIn .55s cubic-bezier(.2,.8,.2,1); }
.slide > * { animation: rise .6s cubic-bezier(.2,.8,.2,1) both; }
.slide > *:nth-child(2) { animation-delay: .08s } .slide > *:nth-child(3) { animation-delay: .16s }
.slide > *:nth-child(4) { animation-delay: .24s } .slide > *:nth-child(5) { animation-delay: .32s }
.slide > *:nth-child(6) { animation-delay: .4s } .slide > *:nth-child(n+7) { animation-delay: .48s }

.t-intro { background: radial-gradient(120% 80% at 10% 0%, #18bcf2 0%, transparent 55%), radial-gradient(100% 70% at 100% 100%, #7c3aed 0%, transparent 60%), #0b1020; }
.t-violet { background: linear-gradient(160deg, #4c1d95, #7c3aed 55%, #c026d3); }
.t-teal { background: linear-gradient(160deg, #064e3b, #0d9488 60%, #5eead4); }
.t-blue { background: linear-gradient(165deg, #0c4a6e, #0284c7 55%, #18bcf2); }
.t-orange { background: linear-gradient(160deg, #7c2d12, #ea580c 55%, #fbbf24); }
.t-pink { background: linear-gradient(160deg, #831843, #db2777 55%, #f9a8d4); }
.t-night { background: radial-gradient(70% 50% at 80% 10%, #312e81 0%, transparent 70%), linear-gradient(180deg, #020617, #1e1b4b); }
.t-green { background: linear-gradient(160deg, #14532d, #16a34a 55%, #bef264); }
.t-heat { background: linear-gradient(170deg, #1e3a8a 0%, #9333ea 45%, #f97316 100%); }
.t-summary { background: radial-gradient(100% 60% at 50% 0%, #18bcf2 0%, transparent 60%), #0b1020; align-items: center; }

.kicker { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; font-weight: 700; opacity: .85; margin-bottom: 14px; }
.mega { font-size: 64px; line-height: .95; font-weight: 900; margin: 0; letter-spacing: -.03em; }
.title { font-size: 44px; line-height: 1; font-weight: 900; margin: 6px 0; letter-spacing: -.02em; }
h2 { font-size: 36px; margin: 0; font-weight: 900; letter-spacing: -.02em; }
.grad { background: linear-gradient(90deg, #18bcf2, #a78bfa, #f472b6); -webkit-background-clip: text; background-clip: text; color: transparent; }
.big { font-size: 112px; line-height: 1; font-weight: 900; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.big small { font-size: 32px; font-weight: 800; letter-spacing: 0; }
.name { font-size: 44px; font-weight: 900; line-height: 1.05; letter-spacing: -.02em; margin: 4px 0; }
.name.small { font-size: 30px; }
.lead { font-size: 20px; margin: 0; font-weight: 600; line-height: 1.3; }
.sub { font-size: 16px; margin: 8px 0 0; opacity: .9; line-height: 1.45; }
.foot { font-size: 13px; opacity: .75; margin: 8px 0 0; }
.hint { margin-top: 36px; font-size: 14px; opacity: .7; animation: pulse 2s infinite !important; }
.divider { height: 1px; background: rgba(255,255,255,.3); margin: 18px 0; }
.emoji { font-size: 64px; line-height: 1; margin-bottom: 8px; } .emoji.xl { font-size: 120px; }

.bars { display: flex; gap: 4px; align-items: flex-end; height: 120px; margin-top: 22px; }
.bar { flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 4px; }
.bar span { width: 100%; height: var(--h); background: rgba(255,255,255,.35); border-radius: 4px 4px 2px 2px; transform-origin: bottom;
  animation: grow .7s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(.4s + var(--i) * .04s); }
.bar.hi span { background: #fff; }
.bar em { font-style: normal; font-size: 10px; opacity: .7; }

.rank { list-style: none; padding: 0; margin: 22px 0 0; display: flex; flex-direction: column; gap: 10px; }
.rank li { display: grid; grid-template-columns: 22px 1fr 70px 28px; align-items: center; gap: 10px; font-size: 16px; font-weight: 600;
  animation: rise .5s both; animation-delay: calc(.4s + var(--i) * .08s); }
.rank .pos { opacity: .6; font-weight: 800; } .rank .lbl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank .meter { height: 6px; background: rgba(255,255,255,.2); border-radius: 6px; overflow: hidden; }
.rank .meter i { display: block; height: 100%; width: var(--w); background: #fff; border-radius: 6px; animation: growX .8s both .6s; transform-origin: left; }
.rank b { text-align: right; }

.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.chips span { background: rgba(255,255,255,.18); padding: 8px 14px; border-radius: 999px; font-size: 14px; font-weight: 600;
  animation: rise .5s both; animation-delay: calc(.4s + var(--i) * .06s); }

.temps { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.temps div { display: flex; justify-content: space-between; background: rgba(255,255,255,.12); padding: 8px 12px; border-radius: 10px; font-size: 15px;
  animation: rise .5s both; animation-delay: calc(.45s + var(--i) * .06s); }

.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
.grid div { background: rgba(255,255,255,.14); border-radius: 18px; padding: 18px 16px; display: flex; flex-direction: column; }
.grid b { font-size: 42px; font-weight: 900; line-height: 1; letter-spacing: -.02em; }
.grid span { font-size: 13px; opacity: .85; margin-top: 6px; }

.card-sum { width: 100%; background: linear-gradient(160deg, rgba(255,255,255,.14), rgba(255,255,255,.04)); border: 1px solid rgba(255,255,255,.2);
  border-radius: 24px; padding: 22px; box-sizing: border-box; }
.sum-head { font-weight: 800; font-size: 15px; display: flex; align-items: center; gap: 8px; }
.logo { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: #18bcf2; font-size: 18px; }
.sum-arch { font-size: 28px; font-weight: 900; margin: 16px 0; letter-spacing: -.02em; }
.sum-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 12px; }
.sum-grid div { display: flex; flex-direction: column; min-width: 0; }
.sum-grid span { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .7; }
.sum-grid b { font-size: 20px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sum-foot { margin-top: 18px; font-size: 12px; opacity: .6; }

@keyframes fill { from { width: 0 } to { width: 100% } }
@keyframes fadeIn { from { opacity: 0 } }
@keyframes slideIn { from { opacity: 0; transform: scale(1.04) } }
@keyframes rise { from { opacity: 0; transform: translateY(18px) } }
@keyframes grow { from { transform: scaleY(0) } }
@keyframes growX { from { transform: scaleX(0) } }
@keyframes pulse { 50% { opacity: .35 } }
@media (prefers-reduced-motion: reduce) { .slide, .slide > *, .bar span, .rank li, .rank .meter i, .chips span, .temps div { animation: none !important; } }
`;

class HaWrappedStory extends HTMLElement {
  open(slides) {
    this.slides = slides;
    this.idx = 0;
    this.dur = 7000;
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STORY_CSS}</style>
      <div class="wrap"><div class="stage">
        <div class="progress">${slides.map(() => "<i><b></b></i>").join("")}</div>
        <button class="close" aria-label="Close">×</button>
        <div class="holder"></div>
        <div class="tapL"></div><div class="tapR"></div>
      </div></div>`;
    this.stage = root.querySelector(".stage");
    this.holder = root.querySelector(".holder");
    root.querySelector(".close").onclick = () => this.close();
    root.querySelector(".tapL").onclick = () => this.go(this.idx - 1);
    root.querySelector(".tapR").onclick = () => this.go(this.idx + 1);
    const hold = (on) => () => { this.paused = on; this.stage.classList.toggle("paused", on); };
    this.stage.addEventListener("pointerdown", (e) => { this._down = Date.now(); hold(true)(); });
    this.stage.addEventListener("pointerup", hold(false));
    this._key = (e) => {
      if (e.key === "Escape") this.close();
      else if (e.key === "ArrowRight" || e.key === " ") this.go(this.idx + 1);
      else if (e.key === "ArrowLeft") this.go(this.idx - 1);
    };
    window.addEventListener("keydown", this._key);
    this.show();
  }
  // Swap in the full deck once data arrives, without re-animating the intro.
  setSlides(slides) {
    this.slides = slides;
    this.shadowRoot.querySelector(".progress").innerHTML = slides.map(() => "<i><b></b></i>").join("");
    const hint = this.holder.querySelector(".hint");
    if (hint) hint.textContent = "Tap to begin →";
    this.updateProgress();
    if (this._wantNext) { this._wantNext = false; this.go(this.idx + 1); }
    else this.startTimer(); // give the intro its full time now that it's tappable
  }
  go(i) {
    if (i < 0) i = 0;
    if (i >= this.slides.length) { this._wantNext = true; return; } // still loading, or on summary
    this.idx = i;
    this.show();
  }
  updateProgress() {
    this.shadowRoot.querySelectorAll(".progress i").forEach((el, i) => {
      el.className = i < this.idx ? "done" : i === this.idx ? "cur" : "";
      el.style.setProperty("--dur", `${this.dur}ms`);
    });
  }
  show() {
    const s = this.slides[this.idx];
    this.holder.innerHTML = `<section class="slide t-${s.theme}">${s.html}</section>`;
    this.updateProgress();
    this.countUp();
    this.startTimer();
  }
  startTimer() {
    // Restart the bar animation too, so it stays in sync with the timer
    const cur = this.shadowRoot.querySelector(".progress i.cur");
    if (cur) { cur.className = ""; void cur.offsetWidth; cur.className = "cur"; }
    clearInterval(this._timer);
    let elapsed = 0;
    this._timer = setInterval(() => {
      if (this.paused) return;
      elapsed += 100;
      if (elapsed >= this.dur && this.idx < this.slides.length - 1) this.go(this.idx + 1);
    }, 100);
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
    clearInterval(this._timer);
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

  // Data is gathered once per browser and cached for a few hours, so only the
  // very first run waits on the recorder.
  prefetch() {
    if (this._dataPromise) return this._dataPromise;
    const key = `ha-wrapped:v1:${this.year}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || "null");
      if (cached && Date.now() - cached.at < CACHE_MS) return (this._dataPromise = Promise.resolve(cached.data));
    } catch (_) { /* storage unavailable */ }
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
    this._dataPromise = new Promise((res) => idle(res, { timeout: 2000 }))
      .then(() => collectWrapped(this._hass, this.year))
      .then((data) => {
        try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch (_) { /* full or blocked */ }
        return data;
      });
    this._dataPromise.catch(() => { this._dataPromise = null; }); // allow retry
    return this._dataPromise;
  }
  getCardSize() { return 3; }
  static getStubConfig() { return {}; }

  render() {
    this.rendered = true;
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ha-card, .card { display: block; overflow: hidden; border-radius: var(--ha-card-border-radius, 12px); cursor: pointer; color: #fff;
          background: radial-gradient(120% 90% at 0% 0%, #18bcf2 0%, transparent 55%), radial-gradient(100% 90% at 100% 100%, #7c3aed 0%, transparent 60%), #0b1020;
          font-family: var(--ha-font-family-body, "Figtree", system-ui, sans-serif); }
        .in { padding: 22px; display: flex; align-items: center; gap: 16px; }
        .txt { flex: 1; }
        .k { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .8; font-weight: 700; }
        .h { font-size: 28px; font-weight: 900; line-height: 1.05; margin: 4px 0 6px; letter-spacing: -.02em; }
        .s { font-size: 13px; opacity: .85; }
        button { all: unset; width: 56px; height: 56px; border-radius: 50%; background: #fff; color: #0b1020; display: grid; place-items: center;
          font-size: 22px; box-shadow: 0 6px 20px rgba(0,0,0,.35); transition: transform .2s; flex: none; }
        .card:hover button { transform: scale(1.08); }
        .err { color: #fecaca; font-size: 12px; margin-top: 6px; }
      </style>
      <ha-card class="card"><div class="in">
        <div class="txt">
          <div class="k">Home Assistant</div>
          <div class="h">Your ${this.year} Wrapped</div>
          <div class="s">Your year in smart home, in ${"one tap"}.</div>
          <div class="err" hidden></div>
        </div>
        <button aria-label="Play">▶</button>
      </div></ha-card>`;
    root.querySelector(".card").addEventListener("click", () => this.play());
  }

  async play() {
    const err = this.shadowRoot.querySelector(".err");
    err.hidden = true;
    // Open straight away on the intro; the rest of the deck slots in when ready.
    const story = document.createElement("ha-wrapped-story");
    document.body.appendChild(story);
    story.open([introSlide(this.year, true)]);
    try {
      const data = await this.prefetch();
      if (story.isConnected) story.setSlides(buildSlides(data));
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
window.customCards.push({ type: "ha-wrapped-card", name: "Home Assistant Wrapped", description: "Your year in smart home, Spotify Wrapped style." });

// Exposed for previews/tests
window.haWrapped = { collectWrapped, buildSlides };
