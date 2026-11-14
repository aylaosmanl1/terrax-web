/* TerraX settings — edit these without touching app.js */
window.TERRAX_CONFIG = {
  // Where the site list comes from (see data/sites.json for the format)
  dataUrl: "data/sites.json",

  // Map start view
  center: [45, 32],       // [longitude, latitude] — Middle East / Caucasus, where our candidates are
  zoom: 2.4,

  // Base maps (raster tiles, no API key needed)
  basemaps: {
    satellite: {
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      labels: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
    },
    dark: {
      tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
      attribution: "© OpenStreetMap contributors © CARTO"
    },
    light: {
      tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
      attribution: "© OpenStreetMap contributors © CARTO"
    }
  },

  // Google Earth Engine analog-index layer (your friend's heatmap).
  // Paste an XYZ tile URL here, e.g. from ee.Image.getMapId() or a map exported
  // with Export.map.toCloudStorage. Leave empty to use the demo heatmap built from site scores.
  analogIndexTiles: "",
  analogIndexOpacity: 0.65,
  analogIndexAttribution: "Analog index: TerraX team, Google Earth Engine"
};
