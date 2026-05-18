# Mammotion Map Assets

Assets and plugins for displaying Mammotion mowers on a map in Home Assistant.

## Installation via HACS

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=mikey0000&repository=ha-mammotion-assets&category=plugin)

Or manually:

1. Open HACS → three-dot menu (⋮) → **Custom repositories**
2. Add `https://github.com/mikey0000/ha-mammotion-assets` with category **Dashboard**
3. Find **Mammotion Assets** and click **Download**

## Contents

- Images for the custom mower card
- Images for displaying your mower on a map
- Images for RTK and dock
- `geojson.js` — renders GeoJSON along with map names and areas
- `mammotion-svg-card.js` — interactive card for placing, editing and deleting SVG pattern tiles on the mower map
- Optional agora-client.js for displaying camera feed with movement controls

## Mammotion SVG Map Card

The `mammotion-svg-card` lets you visually place SVG pattern tiles on your mower's map and send them to the device directly from the dashboard.

### Requirements

The **Mammotion** integration must be installed and at least one mower must have a synced map (run a map sync from the app if needed).

### Adding the card

In your Lovelace dashboard → **Edit** → **Add Card** → **Custom: Mammotion SVG Map Aligner**.

Or paste the YAML manually:

```yaml
type: custom:mammotion-svg-card
entity: lawn_mower.my_luba2   # optional: pre-selects this mower on load
device_type: "2.5"            # "2.5" = Luba 1 / Yuka (default), "4.0" = Luba 2
card_height: 600              # optional height in px (default 600)
```

The `entity` field is optional. If omitted, the card shows a **Mower** dropdown populated from all `lawn_mower.*` entities in HA — useful if you have multiple mowers.

### How to use

1. **Select a mower** from the dropdown (auto-populated from all `lawn_mower.*` entities in HA).
2. **Select an area** from the area dropdown — the mower map renders with all areas shown.
3. **Load an SVG** — drag a `.svg` file onto the drop zone, click to browse, or paste SVG markup directly.
4. **Position the tile** — drag it on the map. Blue circle = move, green circle (SE corner) = scale, amber circle (top) = rotate.
5. Fine-tune position, scale, rotation, and dimensions in the **Transform** panel.
6. Click **Send to Device** — the tile is chunked and sent via the `mammotion.svg_add` service. The device-assigned hash is shown on success.
7. Use the **Existing** tab to see tiles already on the device. Click **Edit** to load a tile back into the Place tab for updating, or **Delete** to remove it.
8. Click **Refresh** at any time to reload the map data from the device.

### Services

The card uses these HA services (also callable directly from **Developer Tools → Services**):

| Service | Description |
|---|---|
| `mammotion.get_map_data` | Returns raw area/SVG data for use by the card |
| `mammotion.svg_add` | Send a new SVG tile → returns `device_hash` |
| `mammotion.svg_update` | Replace an existing tile by `device_hash` |
| `mammotion.svg_delete` | Remove a tile by `device_hash` |

All services take `entity_id` (any Mammotion entity for the target mower) plus operation-specific fields. See the integration's **Services** page in Developer Tools for full field documentation.

## Image naming guide

Asset filenames encode the device model via a suffix. The tables below map each
suffix to the Mammotion product name, the device-name prefix broadcast by the
hardware, and the hardware model number. Source of truth:
[`pymammotion/utility/device_type.py`](https://github.com/mikey0000/Luba-API/blob/main/pymammotion/utility/device_type.py).

### Luba series

| File suffix | Device prefix | Model # | Product name |
|---|---|---|---|
| `luba` | `Luba` | — | Luba 1 |
| `luba_pro` | `Luba` | — | Luba 1 Pro |
| `luba2` | `Luba-VS` | — | Luba 2 |
| `luba_vp` | `Luba-VP` | HM441 | Luba 2 Pro |
| `luba_mn` | `Luba-MN` | HM430 | Luba 2 Mini |
| `luba_ld` | `Luba-LD` | HM431 | Luba 2 Mini Vision Lidar |
| `luba_442` | `Luba-VA` | HM442 | Luba 3 |
| `luba_la_432` | `Luba-LA` | HM432 | Luba Mini Vision Lidar |
| `luba_434` / `luba_mb` | `Luba-MB` | HM434 | Luba MB |
| `new_pro` | `Luba-HM` | HM610 | Luba HM |

### Yuka series

| File suffix | Device prefix | Model # | Product name |
|---|---|---|---|
| `yuka` | `Yuka-` | — | Yuka |
| `yuka_mn` | `Yuka-MN` | — | Yuka Mini |
| `yuka_vp` | `Yuka-VP` | MN241 | Yuka Pro |
| `yuka_mn_231` | `Yuka-MV` | MN231 | Yuka Mini V |
| `yuka_ml` | `Yuka-ML` | MN232 | Yuka ML |

### RTK base stations

| File suffix | Device prefix | Model # | Product name |
|---|---|---|---|
| `rtk` | `RTK` | — | RTK Gen 1 |
| `rtk3` | `RBSA1` | RBS03A1 | RTK Gen 3 |
| `rtk3_a0` | `RBSA0` | RBS03A0 | RTK Gen 3 (A0 variant) |
| `rtk3_a2` | `RBSA2` | RBS03A2 | RTK Gen 3 (A2 variant) |

### Spino series (swimming pool)

| File suffix | Device prefix | Product name |
|---|---|---|
| `spino` | `Spino` | Spino |
| `spino_pro` | `Spino-E1` | Spino E1 |
| `spino_pile_pro` | `Spino-S1` | Spino S1 |

### Image categories

| Prefix | Folder | Description |
|---|---|---|
| `dc_bg_main_car_` | `assets/` | Full background image shown on the main card |
| `dc_img_*_side` | `assets/` | Side-profile image used in detail views |
| `dc_type_car_` | `assets/` | Small thumbnail used in model-selection UI |
| `seekbar_car_` | `assets/` | Top-down silhouette used on the remote control seekbar |
| `car_` | `assets/` | Small icon used in lists and selectors |
| `newui_img_*` | `assets/` | Images for the newer app UI layout |
| `newui_bg_main_` | `assets/` | Background images for the newer app UI layout |
| `newui_type_` | `assets/` | Type thumbnails for the newer app UI layout |
| `dc_newui_icon_map_` | `assets/map/` | Map icon shown at the mower's position |

The `_offline` suffix on background images is the greyed-out variant shown when
the mower is not connected. The `_grey` suffix on map icons serves the same
purpose. The `_white` suffix denotes white-coloured model variants.
