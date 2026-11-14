# TerraX website

Static website: plain HTML, CSS and JavaScript. No build step, no API keys.
Map: MapLibre GL (loaded from a CDN) with Esri satellite imagery and CARTO base maps.

```
index.html              page structure (hero, map, sites, method, team)
assets/css/style.css    design tokens (colors, fonts) + all styles
assets/js/config.js     settings: start view, base maps, Earth Engine layer URL
assets/js/app.js        map, filters, site panel, site cards
assets/brand/           logos and favicons (standard + Azerbaijan, dark + light)
data/sites.json         the analog sites (DEMO scores, replace with real results)
```

## Run it on your computer
Opening `index.html` by double-clicking won't load the data (browsers block it). Run a tiny server in this folder instead:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
# or
npx serve .
```

## Deploy on Vercel
1. Push this folder to a GitHub repo.
2. On vercel.com: Add New → Project → import the repo.
3. Framework preset: **Other**. Leave build command and output directory empty. Deploy.

Every push to GitHub redeploys automatically, so teammates can update `data/sites.json` and the site updates itself.

## Edit the sites (data/sites.json)
Each site looks like this:

```json
{
  "id": "dasht-e-lut",                 // unique, used in links: /#site=dasht-e-lut
  "name": "Lut Desert (Dasht-e Lut)",
  "country": "Iran",
  "lat": 30.40, "lng": 58.90,
  "target": "mars",                    // "mars" or "moon"
  "targetSite": "Yardang fields, Medusae Fossae",
  "environment": ["desert", "yardangs"],   // becomes the filter chips automatically
  "status": "candidate",               // "known" or "candidate" (new find)
  "index": 0.84,                       // analog index 0–1
  "scores": { "aridity": 10, "temperature": 7, "terrain": 9, "geology": 7, "dust": 8, "radiation": 9 },  // 0–10
  "summary": "One or two sentences.",
  "matches": ["Wind-carved yardangs", "..."],
  "usedBy": ["..."],
  "sources": ["MODIS land surface temperature", "..."]
}
```

When the real scores are in, also remove the "Demo data" badge in `index.html` and the demo sentence in the footer.

## Add the Google Earth Engine heatmap
Right now the colored heat layer is generated from the site scores. To show the real Earth Engine analog-index image instead, put an XYZ tile URL in `assets/js/config.js` → `analogIndexTiles`.

- Quick (temporary, URLs expire after a while): in the Earth Engine Python API,
  `image.getMapId(vis)["tile_fetcher"].url_format`
- Permanent: `Export.map.toCloudStorage(...)` in the Code Editor, make the bucket public, and use
  `https://storage.googleapis.com/<bucket>/<path>/{z}/{x}/{y}`

Use the same 7-color palette as the site for the visualization:
`['30123B','4686FB','1AE4B6','A2FC3C','FABA39','E4460A','7A0403']`

## Brand
Colors and fonts follow the TerraX brand sheet in Figma. Fonts: Syne (headings), Inter (text), JetBrains Mono (data), from Google Fonts.
