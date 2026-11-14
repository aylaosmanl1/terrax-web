/* =========================================================
   TerraX — interactive analog map
   No build step: plain JavaScript + MapLibre GL (loaded from CDN)
   ========================================================= */
(function () {
  "use strict";

  const CFG = window.TERRAX_CONFIG || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const COLORS = { mars: "#C9562C", moon: "#C8C3B6", ignition: "#FFB238", cream: "#F1EBDD" };
  const TURBO = ["#30123B", "#4686FB", "#1AE4B6", "#A2FC3C", "#FABA39", "#E4460A", "#7A0403"];
  const SCORE_LABELS = {
    aridity: "Aridity", temperature: "Temperature", terrain: "Terrain",
    geology: "Geology", dust: "Dust", radiation: "UV / radiation"
  };

  const state = {
    sites: [], target: "all", status: "all", envs: new Set(),
    minIndex: 0, sort: "index", selected: null, base: "satellite", heat: true
  };
  let map = null;
  let mapReady = false;
  let hoverPopup = null;

  /* ---------------- helpers ---------------- */
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtCoord = (lat, lng) =>
    `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}  ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;
  const safeHash = (h) => { try { history.replaceState(null, "", h || location.pathname); } catch (e) { /* sandboxed */ } };
  const isMobile = () => window.matchMedia("(max-width: 720px)").matches;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  };

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
    // follow the theme with the flat base map, but keep satellite if the user chose it
    if (state.base !== "satellite") setBase(next);
  });

  /* ---------------- data ---------------- */
  fetch(CFG.dataUrl || "data/sites.json")
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((data) => {
      state.sites = (data.sites || []).filter((s) => isFinite(s.lat) && isFinite(s.lng));
      buildEnvChips();
      renderStats();
      render();
      initMap();
      // open a site from the URL, e.g. /#site=dasht-e-lut
      const m = location.hash.match(/^#site=(.+)$/);
      if (m) selectSite(decodeURIComponent(m[1]), false);
    })
    .catch((err) => {
      console.error("TerraX: could not load site data", err);
      $("#siteCards").innerHTML =
        '<p class="empty">Could not load <code>data/sites.json</code>. If you opened <code>index.html</code> by double-clicking it, run a small local server instead (see README).</p>';
      initMap();
    });

  function filtered() {
    return state.sites.filter((s) =>
      (state.target === "all" || s.target === state.target) &&
      (state.status === "all" || s.status === state.status) &&
      s.index >= state.minIndex &&
      (state.envs.size === 0 || (s.environment || []).some((e) => state.envs.has(e)))
    );
  }

  function sorted(list) {
    const by = state.sort;
    return list.slice().sort((a, b) =>
      by === "index" ? b.index - a.index : String(a[by]).localeCompare(String(b[by]))
    );
  }

  /* ---------------- UI: filters ---------------- */
  function buildEnvChips() {
    const envs = [...new Set(state.sites.flatMap((s) => s.environment || []))].sort();
    $("#envChips").innerHTML = envs
      .map((e) => `<button class="chip" data-env="${esc(e)}" aria-pressed="false">${esc(e)}</button>`)
      .join("");
    $$("#envChips .chip").forEach((chip) =>
      chip.addEventListener("click", () => {
        const e = chip.dataset.env;
        state.envs.has(e) ? state.envs.delete(e) : state.envs.add(e);
        chip.classList.toggle("is-on");
        chip.setAttribute("aria-pressed", chip.classList.contains("is-on"));
        render();
      })
    );
  }

  function bindSeg(id, key, onChange) {
    $$(`#${id} button`).forEach((b) =>
      b.addEventListener("click", () => {
        $$(`#${id} button`).forEach((x) => x.classList.remove("is-on"));
        b.classList.add("is-on");
        const val = b.dataset[key];
        onChange(val);
      })
    );
  }
  bindSeg("targetSeg", "target", (v) => { state.target = v; render(); });
  bindSeg("statusSeg", "status", (v) => { state.status = v; render(); });
  bindSeg("baseSeg", "base", (v) => setBase(v));

  $("#minIndex").addEventListener("input", (e) => {
    state.minIndex = parseFloat(e.target.value);
    $("#minIndexOut").textContent = state.minIndex.toFixed(2);
    render();
  });
  $("#heatToggle").addEventListener("change", (e) => { state.heat = e.target.checked; setHeat(); });
  $("#sortBy").addEventListener("change", (e) => { state.sort = e.target.value; renderCards(filtered()); });
  $("#filtersToggle").addEventListener("click", () => {
    const f = $("#filters");
    const collapsed = f.classList.toggle("is-collapsed");
    $("#filtersToggle").setAttribute("aria-expanded", String(!collapsed));
    $("#filtersToggle").setAttribute("aria-label", collapsed ? "Expand filters" : "Collapse filters");
  });
  if (window.innerWidth > 0 && isMobile()) $("#filtersToggle").click();

  /* ---------------- render ---------------- */
  function renderStats() {
    const s = state.sites;
    const counts = {
      total: s.length,
      mars: s.filter((x) => x.target === "mars").length,
      moon: s.filter((x) => x.target === "moon").length,
      candidate: s.filter((x) => x.status === "candidate").length
    };
    $$("[data-stat]").forEach((el) => { el.textContent = counts[el.dataset.stat]; });
  }

  function render() {
    const list = filtered();
    $("#resultCount").textContent = `${list.length} of ${state.sites.length} sites`;
    renderCards(list);
    updateMapData(list);
  }

  function renderCards(list) {
    const el = $("#siteCards");
    if (!list.length) {
      el.innerHTML = '<p class="empty">No sites match these filters. Try lowering the minimum analog index.</p>';
      return;
    }
    el.innerHTML = sorted(list).map((s) => {
      const color = COLORS[s.target];
      return `
      <button class="card" data-id="${esc(s.id)}" aria-label="Show ${esc(s.name)} on the map">
        <div class="card__top">
          <span class="badge badge--${s.target}">${s.target === "mars" ? "Mars" : "Moon"} analog</span>
          <span class="card__index">${s.index.toFixed(2)}</span>
        </div>
        <span class="card__name">${esc(s.name)}</span>
        <span class="card__place">${esc(s.country)} · <span class="mono">${fmtCoord(s.lat, s.lng)}</span></span>
        <span class="card__twin">Twin: <b>${esc(s.targetSite)}</b></span>
        <div class="card__bar"><i style="width:${Math.round(s.index * 100)}%;background:${color}"></i></div>
        ${s.status === "candidate" ? '<span class="badge badge--new">New candidate</span>' : ""}
      </button>`;
    }).join("");
    $$(".card", el).forEach((c) =>
      c.addEventListener("click", () => {
        $("#map").scrollIntoView({ behavior: "smooth" });
        selectSite(c.dataset.id, true);
      })
    );
  }

  /* ---------------- drawer ---------------- */
  function openDrawer(s) {
    const color = COLORS[s.target];
    const scores = Object.entries(s.scores || {}).map(([k, v]) => `
      <div class="bar">
        <span>${esc(SCORE_LABELS[k] || k)}</span>
        <div class="bar__track"><div class="bar__fill" style="width:${v * 10}%;background:${color}"></div></div>
        <span class="bar__val">${v}</span>
      </div>`).join("");
    const tags = (s.matches || []).map((m) => `<span class="tag">${esc(m)}</span>`).join("");
    const used = (s.usedBy || []).map((m) => `<li>${esc(m)}</li>`).join("");
    const src = (s.sources || []).map((m) => `<li>${esc(m)}</li>`).join("");

    $("#drawerBody").innerHTML = `
      <div class="d-badges">
        <span class="badge badge--${s.target}">${s.target === "mars" ? "Mars" : "Moon"} analog</span>
        <span class="badge ${s.status === "candidate" ? "badge--new" : "badge--known"}">${s.status === "candidate" ? "New candidate" : "Known analog"}</span>
      </div>
      <h2 class="d-name">${esc(s.name)}</h2>
      <p class="d-place">${esc(s.country)} · ${(s.environment || []).map(esc).join(", ")}</p>
      <p class="d-coords mono">${fmtCoord(s.lat, s.lng)}</p>

      <div class="d-index">
        <span class="d-index__num">${s.index.toFixed(2)}</span>
        <div style="flex:1">
          <span class="d-index__label">Analog index<br/>0 = no match · 1 = identical</span>
          <div class="d-index__bar"><i style="left:calc(${Math.round(s.index * 100)}% - 1px)"></i></div>
        </div>
      </div>

      <div class="d-twin">
        <div><span>On Earth</span>${esc(s.name.split(",")[0])}</div>
        <span class="d-twin__arrow">⇄</span>
        <div><span>On ${s.target === "mars" ? "Mars" : "the Moon"}</span>${esc(s.targetSite)}</div>
      </div>

      <p style="margin-top:20px">${esc(s.summary || "")}</p>

      <div class="d-section"><h3>Score breakdown</h3><div class="bars">${scores}</div></div>
      ${tags ? `<div class="d-section"><h3>What matches</h3><div class="d-tags">${tags}</div></div>` : ""}
      ${used ? `<div class="d-section"><h3>Used for</h3><ul class="d-list">${used}</ul></div>` : ""}
      ${src ? `<div class="d-section"><h3>Data sources</h3><ul class="d-list">${src}</ul></div>` : ""}

      <div class="d-actions">
        <button class="btn btn--primary btn--sm" id="dZoom">Zoom to site</button>
        <button class="btn btn--ghost btn--sm" id="dCopy">Copy coordinates</button>
      </div>`;

    $("#dZoom").addEventListener("click", () => flyTo(s, 9));
    $("#dCopy").addEventListener("click", (e) => {
      const text = `${s.lat}, ${s.lng}`;
      const done = () => { e.target.textContent = "Copied"; setTimeout(() => (e.target.textContent = "Copy coordinates"), 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(() => {});
    });

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
    if (fly) flyTo(s, 6);
  }

  /* ---------------- map ---------------- */
  function toGeoJSON(list) {
    return {
      type: "FeatureCollection",
      features: list.map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        properties: { id: s.id, name: s.name, target: s.target, status: s.status, index: s.index }
      }))
    };
  }

  function rasterSource(cfg) {
    return { type: "raster", tiles: cfg.tiles, tileSize: 256, attribution: cfg.attribution, maxzoom: 19 };
  }

  /* simplified world map (no tiles) — used by the in-chat preview, or as an offline fallback */
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
      // drop empty rings/polygons (the source has a few) — MapLibre crashes on them
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
  }

  function initMap() {
    if (!window.maplibregl) {
      $("#mapFallback").hidden = false;
      return;
    }
    const VECTOR = CFG.basemapMode === "vector";
    if (VECTOR) { const seg = $("#baseSeg"); if (seg) seg.hidden = true; }
    const B = CFG.basemaps;
    const sources = {
      satellite: rasterSource(B.satellite),
      dark: rasterSource(B.dark),
      light: rasterSource(B.light),
      labels: { type: "raster", tiles: B.satellite.labels, tileSize: 256, maxzoom: 19 }
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
        center: CFG.center || [45, 32],
        zoom: CFG.zoom || 2.4,
        minZoom: 1.2,
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
      // analog index layer: real Earth Engine tiles if configured, otherwise a demo heatmap
      if (CFG.analogIndexTiles) {
        map.addSource("analog-raster", {
          type: "raster", tiles: [CFG.analogIndexTiles], tileSize: 256,
          attribution: CFG.analogIndexAttribution || ""
        });
        map.addLayer({ id: "analog-raster", type: "raster", source: "analog-raster",
          paint: { "raster-opacity": CFG.analogIndexOpacity || 0.65 } });
      }

      map.addSource("sites", { type: "geojson", data: toGeoJSON(filtered()) });

      if (!CFG.analogIndexTiles) {
        map.addLayer({
          id: "analog-heat", type: "heatmap", source: "sites",
          paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "index"], 0.5, 0.2, 1, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 1, 0.8, 8, 2],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 1, 26, 5, 70, 9, 140],
            "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 1, 0.75, 10, 0.45],
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
              0, "rgba(48,18,59,0)", 0.12, TURBO[1], 0.3, TURBO[2], 0.5, TURBO[3],
              0.68, TURBO[4], 0.85, TURBO[5], 1, TURBO[6]]
          }
        });
      }

      if (!VECTOR) {
        if (!map.getSource("labels")) map.addSource("labels", sources.labels);
        map.addLayer({ id: "base-labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.85 } });
      }

      map.addLayer({
        id: "sites-halo", type: "circle", source: "sites",
        filter: ["==", ["get", "status"], "candidate"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 10, 8, 16],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": COLORS.ignition,
          "circle-stroke-width": 2
        }
      });
      map.addLayer({
        id: "sites-dot", type: "circle", source: "sites",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["+", 4, ["*", 4, ["get", "index"]]], 8, ["+", 7, ["*", 6, ["get", "index"]]]],
          "circle-color": ["match", ["get", "target"], "mars", COLORS.mars, "moon", COLORS.moon, "#888"],
          "circle-stroke-color": COLORS.cream,
          "circle-stroke-width": 1.5
        }
      });
      map.addLayer({
        id: "sites-selected", type: "circle", source: "sites",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, 15, 8, 22],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#FFFFFF",
          "circle-stroke-width": 2.5
        }
      });

      mapReady = true;
      setBase(state.base);
      setHeat();
      updateSelected();

      hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });
      map.on("mouseenter", "sites-dot", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const f = e.features[0];
        hoverPopup.setLngLat(f.geometry.coordinates).setHTML(
          `${esc(f.properties.name)} · <span class="mono">${Number(f.properties.index).toFixed(2)}</span>`
        ).addTo(map);
      });
      map.on("mouseleave", "sites-dot", () => { map.getCanvas().style.cursor = ""; hoverPopup.remove(); });
      map.on("click", "sites-dot", (e) => selectSite(e.features[0].properties.id, true));

      // a site may already be selected (from the URL) before the map finished loading
      if (state.selected) {
        const s = state.sites.find((x) => x.id === state.selected);
        if (s) flyTo(s, 6);
      }
    });

    map.on("error", (e) => console.warn("TerraX map:", e && e.error ? e.error.message : e));
  }

  function updateMapData(list) {
    if (!mapReady) return;
    const src = map.getSource("sites");
    if (src) src.setData(toGeoJSON(list));
  }

  function updateSelected() {
    if (!mapReady) return;
    map.setFilter("sites-selected", ["==", ["get", "id"], state.selected || ""]);
  }

  function setBase(base) {
    state.base = base;
    $$("#baseSeg button").forEach((b) => b.classList.toggle("is-on", b.dataset.base === base));
    if (!mapReady || CFG.basemapMode === "vector") return;
    ["satellite", "dark", "light"].forEach((b) =>
      map.setLayoutProperty(`base-${b}`, "visibility", b === base ? "visible" : "none")
    );
    map.setLayoutProperty("base-labels", "visibility", base === "satellite" ? "visible" : "none");
  }

  function setHeat() {
    if (!mapReady) return;
    const vis = state.heat ? "visible" : "none";
    ["analog-heat", "analog-raster"].forEach((id) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis); });
    $("#legendRamp").style.opacity = state.heat ? "1" : ".4";
  }

  function flyTo(s, zoom) {
    if (!mapReady) return;
    const open = $("#drawer").classList.contains("is-open");
    const padding = isMobile()
      ? { top: 20, bottom: open ? window.innerHeight * 0.55 : 20, left: 20, right: 20 }
      : { top: 40, bottom: 40, left: 340, right: open ? 440 : 40 };
    map.flyTo({ center: [s.lng, s.lat], zoom, speed: 1.3, curve: 1.5, padding, essential: true });
  }
})();
