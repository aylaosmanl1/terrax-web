/* =========================================================
   TerraX: page logic + interactive analog map
   No build step: plain JavaScript + MapLibre GL (loaded from CDN)
   All numbers come from data/sites.json (taken from the project report).
   ========================================================= */
(function () {
  "use strict";

  const CFG = window.TERRAX_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // category colors, validated for colour-blind separation on the dark surface
  const CAT = {
    known: { color: "#2A9D8F", label: "Known analog" },
    discovery: { color: "#B35BD6", label: "TerraX discovery" },
    case: { color: "#C9812A", label: "Case-study site" }
  };
  const TARGET_NAME = { jezero: "Jezero Crater (Mars)", moon: "the lunar south pole (Moon)", arabia: "Arabia Terra (Mars)", mars4: "the average of 4 Mars sites" };
  const RING = "#F1EBDD";

  const state = { sites: [], hotspots: [], catalogue: [], targets: [], target: "jezero", selected: null, base: "satellite" };
  let map = null;
  let mapReady = false;
  let popup = null;

  /* ---------------- helpers ---------------- */
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtCoord = (lat, lng, d = 2) =>
    `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(d)}°${lng >= 0 ? "E" : "W"}`;
  const safeHash = (h) => { try { history.replaceState(null, "", h || location.pathname); } catch (e) { /* sandboxed */ } };
  const isMobile = () => window.matchMedia("(max-width: 720px)").matches;
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };
  const fmtNum = (n) => Number(n).toLocaleString("en-US");

  // score of a site against a target: {text, num (for sizing/sorting), approx}
  function score(site, target) {
    const s = site.scores && site.scores[target];
    if (!s) return null;
    if (s.value != null) return { text: `${s.approx ? "≈ " : ""}${s.value}`, num: s.value, approx: !!s.approx, lo: s.value, hi: s.value };
    if (s.range) {
      const [lo, hi] = s.range.split(/[–-]/).map(Number);
      return { text: s.range, num: (lo + hi) / 2, approx: false, range: true, lo, hi };
    }
    return null;
  }

  /* ---------------- theme ---------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const btn = $("#themeToggle");
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    $('meta[name="theme-color"]').setAttribute("content", theme === "dark" ? "#07090F" : "#F4F1EA");
    store.set("terrax-theme", theme);
  }
  applyTheme(store.get("terrax-theme") || "dark");
  $("#themeToggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    recolorVector();
    if (state.base !== "satellite") setBase(next);
  });

  /* ---------------- links from config ---------------- */
  const LINKS = CFG.links || {};
  $$("[data-link]").forEach((a) => {
    const url = LINKS[a.dataset.link];
    if (url) a.href = url; else a.hidden = true;
  });

  /* ---------------- scroll reveal ---------------- */
  (function reveal() {
    const els = $$(".reveal");
    if (reduceMotion() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("is-in")); return; }
    document.documentElement.classList.add("js-reveal");
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach((e) => io.observe(e));
  })();

  /* ---------------- shared tooltip ---------------- */
  const tip = document.createElement("div");
  tip.className = "tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  document.body.appendChild(tip);
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 14));
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    tip.style.transform = `translate(${left}px, ${top}px)`;
  }
  const hideTip = () => { tip.hidden = true; };

  /* ---------------- data ---------------- */
  fetch(CFG.dataUrl || "data/sites.json")
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      state.sites = (data.sites || []).filter((s) => isFinite(s.lat) && isFinite(s.lng));
      state.hotspots = data.hotspots || [];
      state.catalogue = data.catalogue || [];
      state.targets = data.targets || [];
      renderTargets();
      renderRanking("#rankJezero", "jezero");
      renderRanking("#rankMoon", "moon");
      renderRanking("#rankMars4", "mars4");
      renderMarsVsMoon();
      renderBreakdownChart("#icaBars", "ica-desert");
      renderEgypt();
      renderHotspotTable();
      initMap();
      const m = location.hash.match(/^#site=(.+)$/);
      if (m) selectSite(decodeURIComponent(m[1]), false);
    })
    .catch((err) => {
      console.error("TerraX: could not load site data", err);
      initMap();
    });

  /* ---------------- sections ---------------- */
  function renderTargets() {
    const el = $("#targetChips");
    if (!el) return;
    el.innerHTML = state.targets.map((t) => `
      <article class="target ${t.body === "Moon" ? "target--moon" : ""}">
        <header><span class="target__body mono">${esc(t.body)}</span>${t.measured ? '<span class="target__flag mono">measured</span>' : '<span class="target__flag target__flag--est mono">estimate</span>'}</header>
        <h4>${esc(t.name)}</h4>
        <dl>
          <div><dt>Slope</dt><dd>${esc(t.slope)}</dd></div>
          <div><dt>Roughness</dt><dd>${esc(t.roughness)}</dd></div>
          <div><dt>Relief</dt><dd>${esc(t.relief)}</dd></div>
          <div><dt>Albedo</dt><dd>${esc(t.albedo)}</dd></div>
        </dl>
        <p class="target__src">${esc(t.source)}</p>
      </article>`).join("");
  }

  // horizontal bar list, one series: the total score. Bar color = site category (legend below the charts).
  function renderRanking(sel, target) {
    const el = $(sel);
    if (!el) return;
    const rows = state.sites.map((s) => ({ s, sc: score(s, target) })).filter((r) => r.sc);
    // single-value rows first, sorted by score; sites that only have a shared range collapse into one group row
    const valued = rows.filter((r) => !r.sc.range).sort((a, b) => b.sc.num - a.sc.num);
    const groups = {};
    rows.filter((r) => r.sc.range).forEach((r) => { (groups[r.sc.text] = groups[r.sc.text] || []).push(r); });

    const bar = (lo, hi, color, isRange) => {
      const left = isRange ? lo : 0;
      const width = isRange ? Math.max(hi - lo, 1.5) : hi;
      return `<div class="hbar__track"><i class="hbar__fill${isRange ? " hbar__fill--range" : ""}" style="left:${left}%;width:${width}%;--c:${color}"></i></div>`;
    };

    let html = valued.map((r) => `
      <button class="hbar" data-jump="${esc(r.s.id)}" data-target-switch="${target}"
        data-tip="${esc(`<strong>${r.s.name}</strong><br>${CAT[r.s.category].label}<br>${r.sc.text}/100 vs ${TARGET_NAME[target]}`)}">
        <span class="hbar__name">${esc(r.s.short || r.s.name)}</span>
        ${bar(0, r.sc.num, CAT[r.s.category].color, false)}
        <span class="hbar__val mono">${esc(r.sc.text)}</span>
      </button>`).join("");

    html += Object.entries(groups).map(([rng, list]) => {
      const names = list.map((r) => r.s.short || r.s.name).join(", ");
      const sc = list[0].sc;
      return `
      <div class="hbar hbar--group" tabindex="0"
        data-tip="${esc(`<strong>${list.length} sites</strong><br>${names}<br>${rng}/100 vs ${TARGET_NAME[target]} (range given for the group)`)}">
        <span class="hbar__name">${list.length} other sites</span>
        ${bar(sc.lo, sc.hi, "var(--muted)", true)}
        <span class="hbar__val mono">${esc(rng)}</span>
      </div>`;
    }).join("");

    html += `<div class="hbar__axis mono" aria-hidden="true"><span></span><span class="hbar__ticks"><i>0</i><i>25</i><i>50</i><i>75</i><i>100</i></span><span></span></div>`;
    el.innerHTML = html;
    bindTips(el);
  }

  function bindTips(root) {
    $$("[data-tip]", root).forEach((n) => {
      n.addEventListener("mousemove", (e) => showTip(n.dataset.tip, e.clientX, e.clientY));
      n.addEventListener("mouseleave", hideTip);
      n.addEventListener("focus", () => { const r = n.getBoundingClientRect(); showTip(n.dataset.tip, r.left + r.width / 2, r.top); });
      n.addEventListener("blur", hideTip);
    });
  }

  function miniBars(obj, color) {
    return Object.entries(obj).map(([k, v]) => `
      <div class="mbar" data-tip="${esc(`<strong>${k}</strong><br>${v}/100`)}">
        <span>${esc(k)}</span>
        <div class="mbar__track"><i style="width:${v}%;background:${color}"></i></div>
        <span class="mono">${v}</span>
      </div>`).join("");
  }

  // one site's five dimensions; the weakest (temperature) is called out in Mars orange, with words, not colour alone
  function renderBreakdownChart(sel, id) {
    const el = $(sel);
    const s = state.sites.find((x) => x.id === id);
    if (!el || !s || !s.breakdown) return;
    const rows = Object.entries(s.breakdown);
    const min = Math.min(...rows.map(([, v]) => v));
    el.innerHTML = rows.map(([k, v]) => `
      <div class="hbar hbar--static${v === min ? " hbar--alert" : ""}" tabindex="0" data-tip="${esc(`<strong>${k}</strong><br>${v}/100 vs Jezero Crater`)}">
        <span class="hbar__name">${esc(k)}</span>
        <div class="hbar__track"><i class="hbar__fill" style="left:0;width:${v}%;--c:${v === min ? "#C9562C" : "#8FA3C7"}"></i></div>
        <span class="hbar__val mono">${v}</span>
      </div>${v === min ? `<p class="hbar__note">↑ the analogy breaks here: ${esc(k.toLowerCase())}, ${v}/100</p>` : ""}`).join("") +
      `<div class="hbar__axis mono" aria-hidden="true"><span></span><span class="hbar__ticks"><i>0</i><i>25</i><i>50</i><i>75</i><i>100</i></span><span></span></div>`;
    bindTips(el);
  }

  function renderMarsVsMoon() {
    const el = $("#marsVsMoon");
    if (!el) return;
    const rows = [
      { name: "Mars · Jezero Crater", best: "Ica Desert, Peru", v: 74, c: "#C9562C", id: "ica-desert", t: "jezero" },
      { name: "Moon · south pole near Shackleton", best: "McMurdo Dry Valleys", v: 58, c: "#8FA3C7", id: "mcmurdo", t: "moon" }
    ];
    el.innerHTML = rows.map((r) => `
      <button class="hbar hbar--wide" data-jump="${r.id}" data-target-switch="${r.t}" data-tip="${esc(`<strong>${r.name}</strong><br>Best match: ${r.best}<br>${r.v}/100`)}">
        <span class="hbar__name">${esc(r.name)}<small>best match: ${esc(r.best)}</small></span>
        <div class="hbar__track"><i class="hbar__fill" style="left:0;width:${r.v}%;--c:${r.c}"></i></div>
        <span class="hbar__val mono">${r.v}</span>
      </button>`).join("") +
      `<div class="hbar__axis hbar--wide mono" aria-hidden="true"><span></span><span class="hbar__ticks"><i>0</i><i>25</i><i>50</i><i>75</i><i>100</i></span><span></span></div>` +
      `<p class="hbar__note muted">Why: no place on Earth is airless, and nothing comes close to the extreme cold of the lunar poles.</p>`;
    bindTips(el);
  }

  function renderEgypt() {
    const el = $("#egyptBars");
    const s = state.sites.find((x) => x.id === "eastern-desert");
    if (!el || !s || !s.breakdown) return;
    el.innerHTML = miniBars(s.breakdown, CAT.discovery.color);
    bindTips(el);
  }

  function renderHotspotTable() {
    const tb = $("#hotspotTable tbody");
    if (!tb) return;
    tb.innerHTML = state.hotspots.map((h) => `
      <tr class="${h.verify ? "is-verify" : ""}" data-hotspot="${h.rank}" tabindex="0" title="Show on the map">
        <td class="mono">${h.rank}</td>
        <td class="mono nowrap">${h.lat.toFixed(2)}, ${h.lng.toFixed(2)}</td>
        <td>${esc(h.place)}</td>
        <td class="num mono">${fmtNum(h.area)}</td>
        <td><span class="htype ${/new/i.test(h.type) ? "htype--new" : /verify/i.test(h.type) ? "htype--verify" : "htype--known"}">${esc(h.type)}</span></td>
      </tr>`).join("");
    $$("tr[data-hotspot]", tb).forEach((tr) => {
      const go = () => {
        const h = state.hotspots.find((x) => x.rank === Number(tr.dataset.hotspot));
        $("#explore").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
        if (h) showHotspot(h, true);
      };
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
  }

  /* ---------------- jump buttons (anywhere on the page) ---------------- */
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-jump]");
    if (!b) return;
    if (b.dataset.targetSwitch) setTarget(b.dataset.targetSwitch);
    $("#explore").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
    hideTip();
    selectSite(b.dataset.jump, true);
  });

  /* ---------------- map controls ---------------- */
  function bindSeg(id, key, onChange) {
    $$(`#${id} button`).forEach((b) => b.addEventListener("click", () => onChange(b.dataset[key])));
  }
  bindSeg("targetSeg", "target", (v) => setTarget(v));
  bindSeg("baseSeg", "base", (v) => setBase(v));
  $("#layerHotspots").addEventListener("change", (e) => setVis(["hot-fill", "hot-line", "hot-line-verify", "hot-marker"], e.target.checked));
  $("#layerCatalogue").addEventListener("change", (e) => setVis(["cat-dot"], e.target.checked));
  $("#filtersToggle").addEventListener("click", () => {
    const f = $("#filters");
    const collapsed = f.classList.toggle("is-collapsed");
    $("#filtersToggle").setAttribute("aria-expanded", String(!collapsed));
    $("#filtersToggle").setAttribute("aria-label", collapsed ? "Expand controls" : "Collapse controls");
  });
  if (isMobile()) $("#filtersToggle").click();

  function setTarget(t) {
    state.target = t;
    $$("#targetSeg button").forEach((b) => b.classList.toggle("is-on", b.dataset.target === t));
    updateSites();
    if (state.selected) { const s = state.sites.find((x) => x.id === state.selected); if (s) openDrawer(s); }
  }

  function setVis(ids, on) {
    if (!mapReady) return;
    ids.forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); });
  }

  /* ---------------- drawer ---------------- */
  function openDrawer(s) {
    const cat = CAT[s.category];
    const main = score(s, state.target);
    const other = state.target === "jezero" ? "moon" : "jezero";
    const alt = score(s, other);
    const sRaw = s.scores[state.target] || {};
    const rank = sRaw.rank ? `#${sRaw.rank} of our scored sites` : sRaw.rankRange ? `ranks ${sRaw.rankRange}` : "";
    const facts = (s.facts || []).map((f) => `<li>${esc(f)}</li>`).join("");
    const extra = Object.entries(s.scores).filter(([k]) => k !== "jezero" && k !== "moon").map(([k, v]) =>
      `<li>${v.value}/100 ${k === "point" ? "" : "vs " + esc(TARGET_NAME[k] || k)}${v.label ? " · " + esc(v.label) : ""}</li>`).join("");

    $("#drawerBody").innerHTML = `
      <div class="d-badges"><span class="badge badge--${s.category}">${cat.label}</span></div>
      <h2 class="d-name">${esc(s.name)}</h2>
      <p class="d-place">${esc(s.country)}</p>
      <p class="d-coords mono">${fmtCoord(s.lat, s.lng, s.lat % 1 && String(s.lat).split(".")[1].length > 2 ? 3 : 2)}${s.approxLocation ? ' · <span title="The report does not give exact coordinates for this site">approximate pin</span>' : ""}</p>

      <div class="d-score">
        ${main ? `<span class="d-score__num">${esc(main.text)}<small>/100</small></span>` : `<span class="d-score__num d-score__num--na">n/a</span>`}
        <div class="d-score__meta">
          <span>Total similarity to ${esc(TARGET_NAME[state.target])}${main && main.range ? " (group range)" : ""}</span>
          ${rank ? `<span class="mono">${esc(rank)}</span>` : ""}
          ${main ? `<div class="d-score__track"><i style="left:${main.lo}%;width:${Math.max(main.hi - main.lo, 0)}%"></i></div>` : ""}
        </div>
      </div>
      ${alt ? `<p class="d-alt">Against ${esc(TARGET_NAME[other])}: <strong class="mono">${esc(alt.text)}/100</strong></p>` : ""}

      <p class="d-summary">${esc(s.summary || "")}</p>

      ${s.breakdown ? `<div class="d-section"><h3>${esc(s.breakdownLabel || "Score breakdown vs Jezero")}</h3><div class="mbars">${miniBars(s.breakdown, cat.color)}</div></div>` : ""}
      ${facts || extra ? `<div class="d-section"><h3>Key facts</h3><ul class="d-list">${facts}${extra}</ul></div>` : ""}
      ${s.breaks ? `<div class="d-section d-breaks"><h3>Where the analogy breaks</h3><p>${esc(s.breaks)}</p></div>` : ""}

      <div class="d-actions">
        <button class="btn btn--primary btn--sm" id="dZoom">Zoom to site</button>
        <button class="btn btn--ghost btn--sm" id="dCopy">Copy coordinates</button>
      </div>
      <p class="d-foot mono">≈ values were read from the report's charts.</p>`;

    $("#dZoom").addEventListener("click", () => flyTo(s.lng, s.lat, 9));
    $("#dCopy").addEventListener("click", (e) => {
      const done = () => { e.target.textContent = "Copied"; setTimeout(() => (e.target.textContent = "Copy coordinates"), 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(`${s.lat}, ${s.lng}`).then(done).catch(() => {});
    });
    bindTips($("#drawerBody"));

    const d = $("#drawer");
    d.classList.add("is-open");
    d.setAttribute("aria-hidden", "false");
    d.scrollTop = 0;
  }

  function closeDrawer() {
    const d = $("#drawer");
    d.classList.remove("is-open");
    d.setAttribute("aria-hidden", "true");
    state.selected = null;
    updateSelected();
    if (location.hash.startsWith("#site=")) safeHash("");
  }
  $("#drawerClose").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  function selectSite(id, fly) {
    const s = state.sites.find((x) => x.id === id);
    if (!s) return;
    state.selected = id;
    openDrawer(s);
    updateSelected();
    safeHash(`#site=${encodeURIComponent(id)}`);
    if (fly) flyTo(s.lng, s.lat, 6);
  }

  /* ---------------- map data ---------------- */
  function sitesGeoJSON() {
    return {
      type: "FeatureCollection",
      features: state.sites.map((s) => {
        const sc = score(s, state.target);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
          properties: { id: s.id, name: s.name, category: s.category, score: sc ? sc.num : 0, label: sc ? sc.text : "n/a" }
        };
      })
    };
  }

  // true-size circles with the same area as each hotspot region (the regions themselves are irregular)
  function hotspotGeoJSON() {
    const feats = [];
    state.hotspots.forEach((h) => {
      const rKm = Math.sqrt(h.area / Math.PI);
      const ring = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const dLat = (rKm / 111.32) * Math.sin(a);
        const dLng = (rKm / (111.32 * Math.cos((h.lat * Math.PI) / 180))) * Math.cos(a);
        ring.push([h.lng + dLng, h.lat + dLat]);
      }
      const props = { rank: h.rank, place: h.place, area: h.area, type: h.type, verify: !!h.verify };
      feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: props });
    });
    return { type: "FeatureCollection", features: feats };
  }
  function hotspotPoints() {
    return { type: "FeatureCollection", features: state.hotspots.map((h) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [h.lng, h.lat] },
      properties: { rank: h.rank, place: h.place, area: h.area, type: h.type, verify: !!h.verify }
    })) };
  }
  function catalogueGeoJSON() {
    return { type: "FeatureCollection", features: state.catalogue.map((c) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: { name: c.name }
    })) };
  }

  function rasterSource(cfg) {
    return { type: "raster", tiles: cfg.tiles, tileSize: 256, attribution: cfg.attribution, maxzoom: 19 };
  }

  /* simplified world map (no tiles): used by the in-chat preview, or as an offline fallback */
  const VEC = {
    dark: { ocean: "#07090F", land: "#1A2232", border: "#34405C", grid: "#151C2B" },
    light: { ocean: "#E6E1D6", land: "#FBFAF6", border: "#CFC7B6", grid: "#D9D2C4" }
  };
  function decodeWorld(raw) {
    if (!raw || !raw.features) return null;
    const scale = raw.UTF8Scale || 1024;
    const dec = (str, off) => {
      const out = []; let px = off[0], py = off[1];
      for (let i = 0; i < str.length; i += 2) {
        let x = str.charCodeAt(i) - 64, y = str.charCodeAt(i + 1) - 64;
        x = (x >> 1) ^ -(x & 1); y = (y >> 1) ^ -(y & 1);
        x += px; y += py; px = x; py = y;
        out.push([x / scale, y / scale]);
      }
      return out;
    };
    const features = raw.features.map((f) => {
      const g = f.geometry;
      if (raw.UTF8Encoding) {
        if (g.type === "Polygon") g.coordinates = g.coordinates.map((c, i) => dec(c, g.encodeOffsets[i]));
        else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((p, i) => p.map((c, j) => dec(c, g.encodeOffsets[i][j])));
      }
      if (g.type === "Polygon") g.coordinates = g.coordinates.filter((r) => r.length >= 4);
      else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map((p) => p.filter((r) => r.length >= 4)).filter((p) => p.length);
      return { type: "Feature", properties: { name: f.properties.name }, geometry: { type: g.type, coordinates: g.coordinates } };
    });
    return { type: "FeatureCollection", features: features.filter((f) => f.geometry.coordinates.length) };
  }
  function graticule() {
    const f = [];
    for (let lng = -180; lng <= 180; lng += 30) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 33 }, (_, i) => [lng, -80 + i * 5]) } });
    for (let lat = -60; lat <= 60; lat += 30) f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
    return { type: "FeatureCollection", features: f };
  }
  function vectorStyle() {
    const c = VEC[document.documentElement.getAttribute("data-theme")] || VEC.dark;
    let world = null;
    try { world = decodeWorld(window.__WORLD_RAW); } catch (e) { console.warn("TerraX: world shapes failed", e); }
    world = world || { type: "FeatureCollection", features: [] };
    return {
      version: 8,
      sources: { world: { type: "geojson", data: world }, grid: { type: "geojson", data: graticule() } },
      layers: [
        { id: "v-ocean", type: "background", paint: { "background-color": c.ocean } },
        { id: "v-grid", type: "line", source: "grid", paint: { "line-color": c.grid, "line-width": 0.6 } },
        { id: "v-land", type: "fill", source: "world", paint: { "fill-color": c.land } },
        { id: "v-border", type: "line", source: "world", paint: { "line-color": c.border, "line-width": 0.6 } }
      ]
    };
  }
  function recolorVector() {
    if (!mapReady || CFG.basemapMode !== "vector") return;
    const c = VEC[document.documentElement.getAttribute("data-theme")] || VEC.dark;
    map.setPaintProperty("v-ocean", "background-color", c.ocean);
    map.setPaintProperty("v-grid", "line-color", c.grid);
    map.setPaintProperty("v-land", "fill-color", c.land);
    map.setPaintProperty("v-border", "line-color", c.border);
    const ring = document.documentElement.getAttribute("data-theme") === "light" ? "#07090F" : RING;
    ["hot-line", "hot-line-verify"].forEach((id) => map.setPaintProperty(id, "line-color", ring));
    map.setPaintProperty("hot-marker", "circle-stroke-color", ring);
  }

  function initMap() {
    if (!window.maplibregl) { $("#mapFallback").hidden = false; return; }
    const VECTOR = CFG.basemapMode === "vector";
    if (VECTOR) { const seg = $("#baseSeg"); if (seg) seg.hidden = true; }
    const B = CFG.basemaps;
    const sources = {
      satellite: rasterSource(B.satellite),
      dark: rasterSource(B.dark),
      light: rasterSource(B.light)
    };
    const layers = [
      { id: "base-satellite", type: "raster", source: "satellite", layout: { visibility: "visible" } },
      { id: "base-dark", type: "raster", source: "dark", layout: { visibility: "none" } },
      { id: "base-light", type: "raster", source: "light", layout: { visibility: "none" } }
    ];

    try {
      map = new maplibregl.Map({
        container: "mapCanvas",
        style: VECTOR ? vectorStyle() : { version: 8, sources, layers },
        center: CFG.center || [10, 15],
        zoom: CFG.zoom || 1.6,
        minZoom: 1,
        maxZoom: 16,
        cooperativeGestures: !VECTOR,
        attributionControl: false
      });
    } catch (err) {
      console.error("TerraX: map failed to start", err);
      $("#mapFallback").hidden = false;
      return;
    }

    if (!VECTOR) map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    if (!VECTOR) map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

    map.on("load", () => {
      // optional global similarity map from Earth Engine
      if (CFG.analogIndexTiles) {
        map.addSource("analog-raster", { type: "raster", tiles: [CFG.analogIndexTiles], tileSize: 256, attribution: CFG.analogIndexAttribution || "" });
        map.addLayer({ id: "analog-raster", type: "raster", source: "analog-raster", paint: { "raster-opacity": CFG.analogIndexOpacity || 0.7 } });
        const l = $("#analogLegend"); if (l) l.hidden = false;
      }
      if (!VECTOR) {
        if (!map.getSource("labels")) map.addSource("labels", { type: "raster", tiles: B.satellite.labels, tileSize: 256, maxzoom: 19 });
        map.addLayer({ id: "base-labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.85 } });
      }

      const ringColor = VECTOR && document.documentElement.getAttribute("data-theme") === "light" ? "#07090F" : RING;

      // hotspot regions (v1): equal-area circles, dashed outline for "verify"
      map.addSource("hotspots", { type: "geojson", data: hotspotGeoJSON() });
      map.addSource("hotspot-pts", { type: "geojson", data: hotspotPoints() });
      map.addLayer({ id: "hot-fill", type: "fill", source: "hotspots", paint: { "fill-color": ringColor, "fill-opacity": 0.08 } });
      map.addLayer({ id: "hot-line", type: "line", source: "hotspots", filter: ["!", ["get", "verify"]], paint: { "line-color": ringColor, "line-width": 1.5, "line-opacity": 0.9 } });
      map.addLayer({ id: "hot-line-verify", type: "line", source: "hotspots", filter: ["get", "verify"], paint: { "line-color": ringColor, "line-width": 1.5, "line-opacity": 0.9, "line-dasharray": [2, 2] } });
      // small ring marker so tiny regions are still visible when zoomed out
      map.addLayer({ id: "hot-marker", type: "circle", source: "hotspot-pts", maxzoom: 6, paint: {
        "circle-radius": 5, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ringColor, "circle-stroke-width": 1.5 } });

      // known-analog catalogue (21 sites)
      map.addSource("catalogue", { type: "geojson", data: catalogueGeoJSON() });
      map.addLayer({ id: "cat-dot", type: "circle", source: "catalogue", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 3, 8, 5],
        "circle-color": "#8E8A80", "circle-stroke-color": "#07090F", "circle-stroke-width": 1, "circle-opacity": 0.9 } });

      // scored sites
      map.addSource("sites", { type: "geojson", data: sitesGeoJSON() });
      map.addLayer({ id: "sites-dot", type: "circle", source: "sites", paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"],
          1, ["interpolate", ["linear"], ["get", "score"], 25, 5, 75, 11],
          8, ["interpolate", ["linear"], ["get", "score"], 25, 8, 75, 16]],
        "circle-color": ["match", ["get", "category"], "known", CAT.known.color, "discovery", CAT.discovery.color, "case", CAT.case.color, "#888"],
        "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2 } });
      map.addLayer({ id: "sites-selected", type: "circle", source: "sites", filter: ["==", ["get", "id"], ""], paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 17, 8, 24],
        "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2.5 } });

      mapReady = true;
      setBase(state.base);
      updateSelected();

      popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      const hover = (layer, html) => {
        map.on("mousemove", layer, (e) => {
          // scored sites sit on top: let their tooltip win
          if (layer !== "sites-dot" && map.queryRenderedFeatures(e.point, { layers: ["sites-dot"] }).length) return;
          map.getCanvas().style.cursor = "pointer";
          popup.setLngLat(e.lngLat).setHTML(html(e.features[0].properties)).addTo(map);
        });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; popup.remove(); });
      };
      hover("sites-dot", (p) => `<strong>${esc(p.name)}</strong><br>${esc(CAT[p.category].label)} · <span class="mono">${esc(p.label)}/100</span>`);
      hover("hot-fill", hotspotTip);
      hover("hot-marker", hotspotTip);
      hover("cat-dot", (p) => `<strong>${esc(p.name)}</strong><br>Known-analog catalogue`);
      map.on("click", "sites-dot", (e) => { e.preventDefault(); selectSite(e.features[0].properties.id, true); });

      if (state.selected) { const s = state.sites.find((x) => x.id === state.selected); if (s) flyTo(s.lng, s.lat, 6); }
    });

    map.on("error", (e) => console.warn("TerraX map:", e && e.error ? e.error.message : e));
  }

  function hotspotTip(p) {
    return `<strong>Hotspot #${p.rank} · ${esc(p.place)}</strong><br><span class="mono">${fmtNum(p.area)} km²</span> · ${esc(p.type)}`;
  }

  function showHotspot(h, fly) {
    if (!mapReady) return;
    if (fly) flyTo(h.lng, h.lat, h.area > 10000 ? 5.5 : 7);
    popup.setLngLat([h.lng, h.lat]).setHTML(hotspotTip({ ...h, verify: !!h.verify })).addTo(map);
  }

  function updateSites() {
    if (!mapReady) return;
    const src = map.getSource("sites");
    if (src) src.setData(sitesGeoJSON());
  }

  function updateSelected() {
    if (!mapReady) return;
    map.setFilter("sites-selected", ["==", ["get", "id"], state.selected || ""]);
  }

  function setBase(base) {
    state.base = base;
    $$("#baseSeg button").forEach((b) => b.classList.toggle("is-on", b.dataset.base === base));
    if (!mapReady || CFG.basemapMode === "vector") return;
    ["satellite", "dark", "light"].forEach((b) => map.setLayoutProperty(`base-${b}`, "visibility", b === base ? "visible" : "none"));
    map.setLayoutProperty("base-labels", "visibility", base === "satellite" ? "visible" : "none");
    const ring = base === "light" ? "#07090F" : RING;
    ["hot-line", "hot-line-verify"].forEach((id) => map.setPaintProperty(id, "line-color", ring));
    map.setPaintProperty("hot-fill", "fill-color", ring);
    map.setPaintProperty("hot-marker", "circle-stroke-color", ring);
  }

  function flyTo(lng, lat, zoom) {
    if (!mapReady) return;
    const open = $("#drawer").classList.contains("is-open");
    const padding = isMobile()
      ? { top: 20, bottom: open ? window.innerHeight * 0.55 : 20, left: 20, right: 20 }
      : { top: 40, bottom: 40, left: 340, right: open ? 440 : 40 };
    map.flyTo({ center: [lng, lat], zoom, speed: 1.3, curve: 1.5, padding, essential: !reduceMotion() });
  }
})();
