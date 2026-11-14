/* TerraX settings: edit these without touching app.js */
window.TERRAX_CONFIG = {
  // Where the site list comes from (see data/sites.json for the format)
  dataUrl: "data/sites.json",

  // Links used by every button with data-link="…". Leave one empty ("") and its buttons hide themselves.
  links: {
    app: "https://secure-current-501008-h9.projects.earthengine.app/view/terrax",
    report: "",   // e.g. a PDF of the report or a Google Drive link
    video: "",    // e.g. a YouTube link to the demo video
    github: "https://github.com/aylaosmanl1/terrax-web"
  },

  // Map start view
  center: [10, 15],       // [longitude, latitude]: the Atlantic, so Peru, Chile and Egypt are all on screen
  zoom: 1.6,

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

  // Optional: the v2 global similarity map from Google Earth Engine as XYZ tiles
  // (e.g. from ee.Image.getMapId() or Export.map.toCloudStorage). When set, the map shows it
  // under the pins with a blue-to-red legend. Leave empty to show pins only.
  analogIndexTiles: "",
  analogIndexOpacity: 0.7,
  analogIndexAttribution: "Similarity map: TerraX team, Google Earth Engine"
};
