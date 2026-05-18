// Mammotion SVG Map Aligner Card
// Allows positioning and sending SVG pattern tiles to a Mammotion robot mower via HA services.

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_SVG_BYTES = 10240;

function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

function hEl(tag, attrs = {}) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "style" && typeof v === "object") {
      Object.assign(e.style, v);
    } else if (k === "textContent") {
      e.textContent = v;
    } else if (k === "innerHTML") {
      e.innerHTML = v;
    } else {
      e.setAttribute(k, v);
    }
  }
  return e;
}

class MammotionSvgCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._entity = null;
    this._defaultEntity = null;
    this._mapData = null;
    this._areaHash = "";
    this._areaNames = {};
    this._svgContent = "";
    this._svgFilename = "pattern.svg";
    this._tform = { x: 0, y: 0, scale: 1.0, rotate: 0.0, bw: 2.5, bh: 2.5, fname: "pattern.svg" };
    this._mapT = null;
    this._dragging = false;
    this._dragStart = null;
    this._editHash = null;
    this._editAreaHash = null;
    this._loading = false;
    this._activeTab = "place";
    this._deviceType = "2.5";
    this._built = false;
    this._boundPointerMove = this._onPointerMove.bind(this);
    this._boundPointerUp = this._onPointerUp.bind(this);
  }

  setConfig(config) {
    this._config = config;
    this._defaultEntity = config.entity || null;
    this._deviceType = config.device_type || "2.5";
    this._cardHeight = config.card_height || 600;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._built) {
      this._build();
      this._built = true;
      this._populateMowers();
    }
  }

  _populateMowers() {
    const sel = this._q("mower-select");
    if (!sel || !this._hass) return;
    const mowers = Object.keys(this._hass.states)
      .filter(id => id.startsWith("lawn_mower."))
      .sort();
    sel.innerHTML = '<option value="">— select mower —</option>'
      + mowers.map(id => {
          const friendly = this._hass.states[id]?.attributes?.friendly_name || id;
          const selected = id === this._defaultEntity ? " selected" : "";
          return `<option value="${id}"${selected}>${friendly}</option>`;
        }).join("");
    // Pre-select default entity and load map
    if (this._defaultEntity && mowers.includes(this._defaultEntity)) {
      this._entity = this._defaultEntity;
      this._refreshMap();
    }
  }

  _q(id) {
    return this.shadowRoot.getElementById(id);
  }

  // ── Build shadow DOM ──────────────────────────────────────────────────────

  _build() {
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = this._css();
    root.appendChild(style);

    const card = hEl("ha-card");
    card.style.height = `${this._cardHeight}px`;
    card.style.display = "flex";
    card.style.flexDirection = "row";
    card.style.overflow = "hidden";
    card.style.background = "#111827";
    card.style.color = "#e5e7eb";
    card.style.fontFamily = "var(--primary-font-family, sans-serif)";

    // Map panel
    const mapPanel = hEl("div", { id: "map-panel", class: "map-panel" });
    const loadOverlay = hEl("div", { id: "load-overlay", class: "load-overlay hidden" });
    loadOverlay.innerHTML = `<div class="spinner"></div>`;
    mapPanel.appendChild(loadOverlay);
    const svgEl = document.createElementNS(SVG_NS, "svg");
    svgEl.setAttribute("id", "map-svg");
    svgEl.setAttribute("width", "100%");
    svgEl.setAttribute("height", "100%");
    svgEl.style.display = "block";
    mapPanel.appendChild(svgEl);
    card.appendChild(mapPanel);

    // Sidebar
    const sidebar = hEl("div", { id: "sidebar", class: "sidebar" });
    sidebar.innerHTML = this._sidebarHtml();
    card.appendChild(sidebar);

    root.appendChild(card);

    this._wireEvents();
  }

  _sidebarHtml() {
    const areas = this._mapData
      ? Object.entries(this._areaNames).map(([h, n]) => `<option value="${h}">${n || h.slice(-8)}</option>`).join("")
      : '<option value="">— load map first —</option>';

    return `
      <div class="sb-row">
        <label class="sb-label">Mower</label>
        <select id="mower-select" class="sb-select"><option value="">— select mower —</option></select>
      </div>
      <div class="sb-row">
        <label class="sb-label">Area</label>
        <select id="area-select" class="sb-select">${areas}</select>
      </div>
      <div class="sb-row">
        <label class="sb-label">Device type</label>
        <select id="device-type-select" class="sb-select">
          <option value="2.5" ${this._deviceType === "2.5" ? "selected" : ""}>Luba1 / Yuka (2.5 m)</option>
          <option value="4.0" ${this._deviceType === "4.0" ? "selected" : ""}>Luba2 (4.0 m)</option>
        </select>
      </div>
      <div class="sb-row">
        <button id="refresh-btn" class="btn btn-secondary">Refresh Map</button>
      </div>

      <div class="tabs">
        <button id="tab-place" class="tab ${this._activeTab === "place" ? "active" : ""}">Place</button>
        <button id="tab-existing" class="tab ${this._activeTab === "existing" ? "active" : ""}">Existing</button>
      </div>

      <div id="panel-place" class="tab-panel ${this._activeTab === "place" ? "" : "hidden"}">
        <div id="dropzone" class="dropzone">
          <span>Drop SVG file here</span>
        </div>
        <textarea id="svg-paste" class="svg-paste" placeholder="…or paste SVG markup here"></textarea>
        <div id="svg-size-banner" class="size-banner hidden"></div>

        <div class="form-grid">
          <label>X move (m)</label>
          <input id="inp-x" type="number" class="inp" step="0.01" value="0">
          <label>Y move (m)</label>
          <input id="inp-y" type="number" class="inp" step="0.01" value="0">
          <label>Scale</label>
          <input id="inp-scale" type="number" class="inp" step="0.01" min="0.01" value="1">
          <label>Rotate (rad)</label>
          <input id="inp-rotate" type="number" class="inp" step="0.001" value="0">
          <label>Base W (m)</label>
          <input id="inp-bw" type="number" class="inp" step="0.1" min="0.1" value="2.5">
          <label>Base H (m)</label>
          <input id="inp-bh" type="number" class="inp" step="0.1" min="0.1" value="2.5">
          <label>Filename</label>
          <input id="inp-fname" type="text" class="inp" value="pattern.svg">
        </div>

        <button id="snap-centroid-btn" class="btn btn-secondary" style="margin-top:6px;width:100%">Snap to Area Centroid</button>
        <button id="send-btn" class="btn btn-primary" style="margin-top:6px;width:100%">Send to Device</button>
        <div id="status-msg" class="status-msg"></div>
      </div>

      <div id="panel-existing" class="tab-panel ${this._activeTab === "existing" ? "" : "hidden"}">
        <div id="tile-list" class="tile-list"></div>
      </div>
    `;
  }

  _css() {
    return `
      :host { display: block; }
      .map-panel { flex: 1; position: relative; background: #0d1117; overflow: hidden; }
      .sidebar { width: 280px; flex-shrink: 0; background: #1f2937; display: flex; flex-direction: column; padding: 8px; overflow-y: auto; gap: 4px; box-sizing: border-box; }
      .load-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 10; }
      .load-overlay.hidden { display: none; }
      .spinner { width: 40px; height: 40px; border: 4px solid #374151; border-top-color: #60a5fa; border-radius: 50%; animation: spin 0.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .sb-row { display: flex; align-items: center; gap: 6px; }
      .sb-label { font-size: 12px; color: #9ca3af; flex-shrink: 0; width: 80px; }
      .sb-select { flex: 1; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 4px 6px; font-size: 12px; }
      .tabs { display: flex; border-bottom: 1px solid #374151; margin-top: 4px; }
      .tab { flex: 1; background: none; border: none; border-bottom: 2px solid transparent; color: #9ca3af; padding: 6px; cursor: pointer; font-size: 13px; }
      .tab.active { color: #60a5fa; border-bottom-color: #60a5fa; }
      .tab-panel { display: flex; flex-direction: column; gap: 4px; padding-top: 6px; }
      .tab-panel.hidden { display: none; }
      .dropzone { border: 2px dashed #374151; border-radius: 6px; padding: 10px; text-align: center; font-size: 12px; color: #6b7280; cursor: pointer; transition: border-color 0.2s; }
      .dropzone.over { border-color: #60a5fa; color: #60a5fa; }
      .svg-paste { width: 100%; height: 70px; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 4px 6px; font-size: 11px; font-family: monospace; resize: vertical; box-sizing: border-box; }
      .size-banner { font-size: 11px; padding: 4px 6px; border-radius: 4px; background: #7f1d1d; color: #fca5a5; border: 1px solid #991b1b; }
      .size-banner.hidden { display: none; }
      .form-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; align-items: center; font-size: 12px; color: #d1d5db; }
      .inp { background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; padding: 3px 6px; font-size: 12px; width: 100%; box-sizing: border-box; }
      .inp:focus { outline: none; border-color: #60a5fa; }
      .btn { border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 13px; font-weight: 500; }
      .btn-primary { background: #2563eb; color: #fff; }
      .btn-primary:hover { background: #1d4ed8; }
      .btn-primary:disabled { background: #374151; color: #6b7280; cursor: not-allowed; }
      .btn-secondary { background: #374151; color: #e5e7eb; }
      .btn-secondary:hover { background: #4b5563; }
      .btn-danger { background: #dc2626; color: #fff; font-size: 11px; padding: 3px 8px; }
      .btn-danger:hover { background: #b91c1c; }
      .btn-edit { background: #2563eb; color: #fff; font-size: 11px; padding: 3px 8px; }
      .btn-edit:hover { background: #1d4ed8; }
      .status-msg { font-size: 12px; min-height: 18px; padding: 2px 0; color: #9ca3af; }
      .status-msg.success { color: #34d399; }
      .status-msg.error { color: #f87171; }
      .tile-list { display: flex; flex-direction: column; gap: 6px; }
      .tile-item { background: #111827; border: 1px solid #374151; border-radius: 6px; padding: 6px 8px; font-size: 12px; }
      .tile-item .tile-hash { color: #60a5fa; font-family: monospace; font-size: 11px; }
      .tile-item .tile-area { color: #9ca3af; font-size: 11px; margin-bottom: 4px; }
      .tile-actions { display: flex; gap: 4px; margin-top: 4px; }
    `;
  }

  // ── Wire DOM events ───────────────────────────────────────────────────────

  _wireEvents() {
    this._q("mower-select").addEventListener("change", (e) => {
      this._entity = e.target.value || null;
      this._mapData = null;
      this._areaHash = "";
      this._areaNames = {};
      this._editHash = null;
      if (this._entity) this._refreshMap();
      else this._redrawMap();
    });
    this._q("refresh-btn").addEventListener("click", () => this._refreshMap());
    this._q("tab-place").addEventListener("click", () => this._switchTab("place"));
    this._q("tab-existing").addEventListener("click", () => this._switchTab("existing"));
    this._q("area-select").addEventListener("change", (e) => {
      this._areaHash = e.target.value;
      this._redrawMap();
    });
    this._q("device-type-select").addEventListener("change", (e) => {
      this._deviceType = e.target.value;
      const def = parseFloat(this._deviceType);
      this._tform.bw = def;
      this._tform.bh = def;
      this._q("inp-bw").value = def;
      this._q("inp-bh").value = def;
      this._updateSvgTilePreview();
    });
    this._q("snap-centroid-btn").addEventListener("click", () => this._snapToCentroid());
    this._q("send-btn").addEventListener("click", () => this._sendToDevice());

    const dropzone = this._q("dropzone");
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("over"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("over"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("over");
      const file = e.dataTransfer.files[0];
      if (file && (file.type === "image/svg+xml" || file.name.endsWith(".svg"))) {
        this._tform.fname = file.name;
        this._q("inp-fname").value = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => { this._setSvgContent(ev.target.result); };
        reader.readAsText(file);
      }
    });
    dropzone.addEventListener("click", () => {
      const fi = document.createElement("input");
      fi.type = "file";
      fi.accept = ".svg,image/svg+xml";
      fi.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        this._tform.fname = file.name;
        this._q("inp-fname").value = file.name;
        const reader = new FileReader();
        reader.onload = (ev) => { this._setSvgContent(ev.target.result); };
        reader.readAsText(file);
      };
      fi.click();
    });

    const pasteArea = this._q("svg-paste");
    pasteArea.addEventListener("input", () => { this._setSvgContent(pasteArea.value); });

    for (const [id, key, parser] of [
      ["inp-x", "x", parseFloat],
      ["inp-y", "y", parseFloat],
      ["inp-scale", "scale", parseFloat],
      ["inp-rotate", "rotate", parseFloat],
      ["inp-bw", "bw", parseFloat],
      ["inp-bh", "bh", parseFloat],
    ]) {
      this._q(id).addEventListener("input", (e) => {
        const v = parser(e.target.value);
        if (!isNaN(v)) { this._tform[key] = v; this._updateSvgTilePreview(); }
      });
    }
    this._q("inp-fname").addEventListener("input", (e) => { this._tform.fname = e.target.value; });

    // SVG drag delegation
    const svgEl = this._q("map-svg");
    svgEl.addEventListener("pointerdown", (e) => this._onHandlePointerDown(e));

    document.addEventListener("pointermove", this._boundPointerMove);
    document.addEventListener("pointerup", this._boundPointerUp);
  }

  _switchTab(tab) {
    this._activeTab = tab;
    this._q("tab-place").classList.toggle("active", tab === "place");
    this._q("tab-existing").classList.toggle("active", tab === "existing");
    this._q("panel-place").classList.toggle("hidden", tab !== "place");
    this._q("panel-existing").classList.toggle("hidden", tab !== "existing");
  }

  // ── SVG content management ────────────────────────────────────────────────

  _setSvgContent(raw) {
    this._svgContent = raw.trim();
    this._q("svg-paste").value = this._svgContent;
    const bytes = new TextEncoder().encode(this._svgContent).length;
    const banner = this._q("svg-size-banner");
    if (bytes > MAX_SVG_BYTES) {
      banner.textContent = `SVG is ${bytes} bytes — exceeds ${MAX_SVG_BYTES} byte limit`;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
    this._updateSvgTilePreview();
  }

  // ── Map data / refresh ────────────────────────────────────────────────────

  async _refreshMap() {
    if (!this._hass || !this._entity) return;
    this._setLoading(true);
    this._setStatus("", "");
    try {
      const resp = await this._hass.callService("mammotion", "get_map_data", { entity_id: this._entity }, {}, false, true);
      this._mapData = resp.response || resp;
      this._areaNames = {};
      if (this._mapData.area_name) {
        for (const an of this._mapData.area_name) {
          this._areaNames[String(an.hash)] = an.name;
        }
      }
      // Rebuild area select
      const sel = this._q("area-select");
      if (sel) {
        sel.innerHTML = Object.entries(this._areaNames)
          .map(([h, n]) => `<option value="${h}">${n || h.slice(-8)}</option>`)
          .join("");
        if (!this._areaHash && sel.options.length) {
          this._areaHash = sel.options[0].value;
          sel.value = this._areaHash;
        } else if (this._areaHash) {
          sel.value = this._areaHash;
        }
      }
      this._buildTileList();
      this._redrawMap();
    } catch (err) {
      this._setStatus("Failed to load map: " + (err.message || err), "error");
    } finally {
      this._setLoading(false);
    }
  }

  _setLoading(v) {
    this._loading = v;
    const ov = this._q("load-overlay");
    if (ov) ov.classList.toggle("hidden", !v);
  }

  _setStatus(msg, type) {
    const el = this._q("status-msg");
    if (!el) return;
    el.textContent = msg;
    el.className = "status-msg" + (type ? " " + type : "");
  }

  // ── Tile list (Existing tab) ──────────────────────────────────────────────

  _buildTileList() {
    const list = this._q("tile-list");
    if (!list || !this._mapData) return;
    list.innerHTML = "";

    const svgMap = this._mapData.svg || {};
    const entries = [];
    for (const [aHash, asvg] of Object.entries(svgMap)) {
      for (const frame of (asvg.data || [])) {
        entries.push({ aHash, frame });
      }
    }

    if (!entries.length) {
      list.innerHTML = '<div style="color:#6b7280;font-size:12px;padding:8px">No SVG tiles on device</div>';
      return;
    }

    for (const { aHash, frame } of entries) {
      const dHash = String(frame.data_hash || frame.paternal_hash_a || "");
      const areaName = this._areaNames[aHash] || aHash.slice(-8);
      const item = hEl("div", { class: "tile-item" });
      item.innerHTML = `
        <div class="tile-hash">Hash: …${dHash.slice(-8)}</div>
        <div class="tile-area">Area: ${areaName}</div>
        <div class="tile-actions">
          <button class="btn btn-edit" data-action="edit" data-dhash="${dHash}" data-ahash="${aHash}">Edit</button>
          <button class="btn btn-danger" data-action="delete" data-dhash="${dHash}" data-ahash="${aHash}">Delete</button>
        </div>
      `;
      item.querySelector("[data-action=edit]").addEventListener("click", () => this._startEdit(dHash, aHash, frame));
      item.querySelector("[data-action=delete]").addEventListener("click", () => this._deleteTile(dHash, aHash));
      list.appendChild(item);
    }
  }

  _startEdit(deviceHash, areaHash, frame) {
    this._editHash = deviceHash;
    this._editAreaHash = areaHash;
    this._areaHash = areaHash;
    const sel = this._q("area-select");
    if (sel) sel.value = areaHash;

    const msg = frame.svg_message || {};
    this._tform.x = msg.x_move || 0;
    this._tform.y = msg.y_move || 0;
    this._tform.scale = msg.scale != null ? msg.scale : 1.0;
    this._tform.rotate = msg.rotate || 0;
    this._tform.bw = msg.base_width_m || parseFloat(this._deviceType);
    this._tform.bh = msg.base_height_m || parseFloat(this._deviceType);

    this._syncFormFromTform();
    this._switchTab("place");
    this._setStatus(`Editing tile …${deviceHash.slice(-8)}`, "");
    this._redrawMap();
  }

  // ── Map transform ─────────────────────────────────────────────────────────

  _computeMapTransform(mapData) {
    const svgEl = this._q("map-svg");
    if (!svgEl) return null;
    const W = svgEl.clientWidth || 600;
    const H = svgEl.clientHeight || this._cardHeight;

    const allPts = [];
    for (const aData of Object.values(mapData.area || {})) {
      for (const pt of this._getAreaPoints(aData)) allPts.push(pt);
    }
    if (!allPts.length) return { ppm: 20, padX: 40, padY: 40, W, H, bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 }, toSX: x => x * 20, toSY: y => H - y * 20 };

    const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
    const b = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    const pad = 40;
    const rangeX = b.maxX - b.minX || 1;
    const rangeY = b.maxY - b.minY || 1;
    const ppm = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
    const padX = (W - rangeX * ppm) / 2;
    const padY = (H - rangeY * ppm) / 2;

    return {
      ppm, padX, padY, W, H, bounds: b,
      toSX: (mx) => padX + (mx - b.minX) * ppm,
      // Y is flipped: ENU coords increase upward, SVG increases downward
      toSY: (my) => H - padY - (my - b.minY) * ppm,
      toMX: (sx) => b.minX + (sx - padX) / ppm,
      toMY: (sy) => b.minY + (H - padY - sy) / ppm,
    };
  }

  _getAreaPoints(areaData) {
    const frames = (areaData.data || []).slice().sort((a, b) => (a.current_frame || 0) - (b.current_frame || 0));
    const pts = [];
    for (const fr of frames) for (const pt of (fr.data_couple || [])) pts.push(pt);
    return pts;
  }

  _centroid(pts) {
    if (!pts.length) return { x: 0, y: 0 };
    // Shoelace signed area centroid
    let A = 0, cx = 0, cy = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      A += cross;
      cx += (pts[i].x + pts[j].x) * cross;
      cy += (pts[i].y + pts[j].y) * cross;
    }
    A /= 2;
    if (Math.abs(A) < 1e-10) {
      // Fallback to mean
      return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
    }
    return { x: cx / (6 * A), y: cy / (6 * A) };
  }

  // ── Full map redraw ───────────────────────────────────────────────────────

  _redrawMap() {
    const svgEl = this._q("map-svg");
    if (!svgEl) return;

    while (svgEl.firstChild) svgEl.removeChild(svgEl.lastChild);

    if (!this._mapData) {
      const t = el("text", { x: "50%", y: "50%", "text-anchor": "middle", fill: "#6b7280", "font-size": "14" });
      t.textContent = "No map data — press Refresh";
      svgEl.appendChild(t);
      return;
    }

    this._mapT = this._computeMapTransform(this._mapData);
    const mt = this._mapT;

    this._drawGrid(svgEl, mt);
    this._drawAreas(svgEl, mt);
    this._drawExistingSvgTiles(svgEl, mt);
    this._drawScaleBar(svgEl, mt);
    this._drawActiveTile(svgEl, mt);
  }

  _drawGrid(svgEl, mt) {
    const g = el("g", { id: "grid", opacity: "0.18" });
    const step = 5; // 5 m grid
    const x0 = Math.floor(mt.bounds.minX / step) * step;
    const x1 = Math.ceil(mt.bounds.maxX / step) * step;
    const y0 = Math.floor(mt.bounds.minY / step) * step;
    const y1 = Math.ceil(mt.bounds.maxY / step) * step;
    for (let mx = x0; mx <= x1; mx += step) {
      const sx = mt.toSX(mx);
      const line = el("line", { x1: sx, y1: 0, x2: sx, y2: mt.H, stroke: "#60a5fa", "stroke-width": "0.5" });
      g.appendChild(line);
    }
    for (let my = y0; my <= y1; my += step) {
      const sy = mt.toSY(my);
      const line = el("line", { x1: 0, y1: sy, x2: mt.W, y2: sy, stroke: "#60a5fa", "stroke-width": "0.5" });
      g.appendChild(line);
    }
    svgEl.appendChild(g);
  }

  _drawAreas(svgEl, mt) {
    if (!this._mapData.area) return;
    const g = el("g", { id: "areas" });
    for (const [hash, aData] of Object.entries(this._mapData.area)) {
      const pts = this._getAreaPoints(aData);
      if (pts.length < 2) continue;
      const isActive = hash === this._areaHash;
      const pointsStr = pts.map(p => `${mt.toSX(p.x).toFixed(1)},${mt.toSY(p.y).toFixed(1)}`).join(" ");
      const poly = el("polygon", {
        points: pointsStr,
        fill: isActive ? "rgba(96,165,250,0.12)" : "rgba(55,65,81,0.25)",
        stroke: isActive ? "#60a5fa" : "#4b5563",
        "stroke-width": isActive ? "2" : "1",
        "stroke-linejoin": "round",
      });
      g.appendChild(poly);

      // Area name label at centroid
      const c = this._centroid(pts);
      const label = el("text", {
        x: mt.toSX(c.x).toFixed(1),
        y: mt.toSY(c.y).toFixed(1),
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        fill: isActive ? "#93c5fd" : "#6b7280",
        "font-size": "11",
        "pointer-events": "none",
      });
      label.textContent = this._areaNames[hash] || hash.slice(-6);
      g.appendChild(label);
    }
    svgEl.appendChild(g);
  }

  _drawExistingSvgTiles(svgEl, mt) {
    if (!this._mapData.svg) return;
    const g = el("g", { id: "existing-tiles" });
    for (const [aHash, asvg] of Object.entries(this._mapData.svg)) {
      for (const frame of (asvg.data || [])) {
        const msg = frame.svg_message;
        if (!msg) continue;
        const dHash = String(frame.data_hash || frame.paternal_hash_a || "");
        if (dHash === this._editHash) continue; // being edited — shown as active tile instead
        const sx = mt.toSX(msg.x_move || 0);
        const sy = mt.toSY(msg.y_move || 0);
        const tw = (msg.base_width_m || 2.5) * mt.ppm * (msg.scale || 1);
        const th = (msg.base_height_m || 2.5) * mt.ppm * (msg.scale || 1);
        const rotDeg = -(msg.rotate || 0) * 180 / Math.PI;
        const tileG = el("g", {
          transform: `translate(${sx},${sy}) rotate(${rotDeg}) translate(${-tw / 2},${-th / 2})`,
          opacity: "0.6",
        });
        const rect = el("rect", { width: tw, height: th, fill: "none", stroke: "#a78bfa", "stroke-width": "1.5", "stroke-dasharray": "5,3" });
        tileG.appendChild(rect);
        const lbl = el("text", { x: tw / 2, y: th / 2, "text-anchor": "middle", "dominant-baseline": "middle", fill: "#a78bfa", "font-size": "9", "pointer-events": "none" });
        lbl.textContent = "…" + dHash.slice(-6);
        tileG.appendChild(lbl);
        g.appendChild(tileG);
      }
    }
    svgEl.appendChild(g);
  }

  _drawScaleBar(svgEl, mt) {
    if (!mt || !mt.ppm) return;
    // 10 m scale bar in bottom-left
    const barM = 10;
    const barPx = barM * mt.ppm;
    const bx = 20, by = mt.H - 24;
    const g = el("g", { id: "scalebar" });
    const line = el("line", { x1: bx, y1: by, x2: bx + barPx, y2: by, stroke: "#e5e7eb", "stroke-width": "2" });
    const t = el("line", { x1: bx, y1: by - 4, x2: bx, y2: by + 4, stroke: "#e5e7eb", "stroke-width": "2" });
    const t2 = el("line", { x1: bx + barPx, y1: by - 4, x2: bx + barPx, y2: by + 4, stroke: "#e5e7eb", "stroke-width": "2" });
    const lbl = el("text", { x: bx + barPx / 2, y: by - 6, "text-anchor": "middle", fill: "#e5e7eb", "font-size": "10" });
    lbl.textContent = `${barM} m`;
    g.appendChild(line); g.appendChild(t); g.appendChild(t2); g.appendChild(lbl);
    svgEl.appendChild(g);
  }

  _drawActiveTile(svgEl, mt) {
    const existing = this._q("active-tile");
    if (existing) existing.remove();

    if (!this._svgContent || !mt) return;

    const tf = this._tform;
    const sx = mt.toSX(tf.x);
    const sy = mt.toSY(tf.y);
    const tw = tf.bw * mt.ppm * tf.scale;
    const th = tf.bh * mt.ppm * tf.scale;
    // ENU rotation is CCW-positive; SVG rotations are CW-positive
    const rotDeg = -tf.rotate * 180 / Math.PI;

    const g = el("g", { id: "active-tile" });

    const innerG = el("g", { transform: `translate(${sx},${sy}) rotate(${rotDeg}) translate(${-tw / 2},${-th / 2})` });

    // Dashed border rect
    const border = el("rect", {
      width: tw, height: th,
      fill: "none",
      stroke: "#60a5fa",
      "stroke-width": "2",
      "stroke-dasharray": "6,3",
    });
    innerG.appendChild(border);

    // SVG content preview via foreignObject
    const fo = el("foreignObject", { x: 0, y: 0, width: tw, height: th });
    const div = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    div.style.width = "100%";
    div.style.height = "100%";
    div.style.overflow = "hidden";
    div.style.pointerEvents = "none";
    div.innerHTML = this._svgContent;
    const inner = div.querySelector("svg");
    if (inner) { inner.setAttribute("width", "100%"); inner.setAttribute("height", "100%"); }
    fo.appendChild(div);
    innerG.appendChild(fo);

    g.appendChild(innerG);

    // Move handle — circle at the center
    const moveHandle = el("circle", {
      cx: sx, cy: sy, r: 8,
      fill: "#2563eb", stroke: "#93c5fd", "stroke-width": "2",
      cursor: "grab",
      "data-handle": "move",
    });
    g.appendChild(moveHandle);

    // Scale handle — SE corner
    const scaleHx = sx + (tw / 2) * Math.cos((-rotDeg * Math.PI) / 180) - (th / 2) * Math.sin((-rotDeg * Math.PI) / 180);
    const scaleHy = sy + (tw / 2) * Math.sin((-rotDeg * Math.PI) / 180) + (th / 2) * Math.cos((-rotDeg * Math.PI) / 180);
    const scaleHandle = el("circle", {
      cx: scaleHx, cy: scaleHy, r: 7,
      fill: "#16a34a", stroke: "#86efac", "stroke-width": "2",
      cursor: "nwse-resize",
      "data-handle": "scale",
    });
    g.appendChild(scaleHandle);

    // Rotate handle — above center (in SVG space, offset upward before rotation)
    // Compute where the "top center - 12px" maps to in screen space after rotation
    const rotRad = (-rotDeg * Math.PI) / 180;
    const rotHx = sx + (-th / 2 - 16) * Math.sin(rotRad);
    const rotHy = sy + (-th / 2 - 16) * Math.cos(rotRad);
    const rotLine = el("line", {
      x1: sx, y1: sy, x2: rotHx, y2: rotHy,
      stroke: "#f59e0b", "stroke-width": "1.5", "stroke-dasharray": "3,2",
      "pointer-events": "none",
    });
    g.appendChild(rotLine);
    const rotateHandle = el("circle", {
      cx: rotHx, cy: rotHy, r: 7,
      fill: "#d97706", stroke: "#fcd34d", "stroke-width": "2",
      cursor: "crosshair",
      "data-handle": "rotate",
    });
    g.appendChild(rotateHandle);

    svgEl.appendChild(g);
  }

  // Only redraws the active tile group — avoids rebuilding the full map on every drag frame
  _updateSvgTilePreview() {
    const svgEl = this._q("map-svg");
    if (!svgEl || !this._mapT) return;
    const existing = svgEl.querySelector("#active-tile");
    if (existing) existing.remove();
    if (this._svgContent) this._drawActiveTile(svgEl, this._mapT);
  }

  // ── Drag interaction ──────────────────────────────────────────────────────

  _onHandlePointerDown(e) {
    const handle = e.target.dataset && e.target.dataset.handle;
    if (!handle) return;
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);

    const mt = this._mapT;
    if (!mt) return;
    const svgEl = this._q("map-svg");
    const rect = svgEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (handle === "move") {
      this._dragging = "move";
      this._dragStart = { sx, sy, ox: this._tform.x, oy: this._tform.y };
    } else if (handle === "scale") {
      const cx = mt.toSX(this._tform.x);
      const cy = mt.toSY(this._tform.y);
      const dist = Math.hypot(sx - cx, sy - cy);
      this._dragging = "scale";
      this._dragStart = { sx, sy, dist, os: this._tform.scale };
    } else if (handle === "rotate") {
      const cx = mt.toSX(this._tform.x);
      const cy = mt.toSY(this._tform.y);
      // startAngle in SVG space; negate to convert back to ENU
      const startAngle = Math.atan2(sy - cy, sx - cx);
      this._dragging = "rotate";
      this._dragStart = { startAngle, or: this._tform.rotate, cx: mt.toSX(this._tform.x), cy: mt.toSY(this._tform.y) };
    }
  }

  _onPointerMove(e) {
    if (!this._dragging || !this._mapT) return;
    const mt = this._mapT;
    const svgEl = this._q("map-svg");
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (this._dragging === "move") {
      const ds = this._dragStart;
      const dmx = (sx - ds.sx) / mt.ppm;
      // SVG y increases downward; map y increases upward
      const dmy = -(sy - ds.sy) / mt.ppm;
      this._tform.x = ds.ox + dmx;
      this._tform.y = ds.oy + dmy;
    } else if (this._dragging === "scale") {
      const ds = this._dragStart;
      const cx = mt.toSX(this._tform.x);
      const cy = mt.toSY(this._tform.y);
      const dist = Math.hypot(sx - cx, sy - cy);
      const ratio = dist / (ds.dist || 1);
      this._tform.scale = Math.max(0.01, ds.os * ratio);
    } else if (this._dragging === "rotate") {
      const ds = this._dragStart;
      const angle = Math.atan2(sy - ds.cy, sx - ds.cx);
      const delta = angle - ds.startAngle;
      // SVG angle is CW-positive; ENU rotation is CCW-positive → negate
      this._tform.rotate = ds.or - delta;
    }

    this._syncFormFromTform();
    this._updateSvgTilePreview();
  }

  _onPointerUp() {
    this._dragging = false;
    this._dragStart = null;
  }

  _syncFormFromTform() {
    const tf = this._tform;
    const set = (id, v) => { const el = this._q(id); if (el) el.value = typeof v === "number" ? v.toFixed(4).replace(/\.?0+$/, "") : v; };
    set("inp-x", tf.x);
    set("inp-y", tf.y);
    set("inp-scale", tf.scale);
    set("inp-rotate", tf.rotate);
    set("inp-bw", tf.bw);
    set("inp-bh", tf.bh);
  }

  // ── Snap to centroid ──────────────────────────────────────────────────────

  _snapToCentroid() {
    if (!this._mapData || !this._areaHash) {
      this._setStatus("Select an area first", "error");
      return;
    }
    const aData = this._mapData.area && this._mapData.area[this._areaHash];
    if (!aData) {
      this._setStatus("Area data not found", "error");
      return;
    }
    const pts = this._getAreaPoints(aData);
    if (!pts.length) {
      this._setStatus("Area has no points", "error");
      return;
    }
    const c = this._centroid(pts);
    this._tform.x = c.x;
    this._tform.y = c.y;
    this._syncFormFromTform();
    this._updateSvgTilePreview();
  }

  // ── Send to device ────────────────────────────────────────────────────────

  async _sendToDevice() {
    if (!this._svgContent) { this._setStatus("No SVG loaded", "error"); return; }
    if (!this._areaHash) { this._setStatus("Select an area", "error"); return; }
    const bytes = new TextEncoder().encode(this._svgContent).length;
    if (bytes > MAX_SVG_BYTES) {
      this._setStatus(`SVG too large (${bytes} bytes, max ${MAX_SVG_BYTES})`, "error");
      return;
    }

    const mode = this._editHash ? "update" : "add";
    const serviceData = {
      entity_id: this._entity,
      area_hash: parseInt(this._areaHash),
      svg_data: this._svgContent,
      svg_file_name: this._tform.fname || "pattern.svg",
      scale: this._tform.scale,
      rotate: this._tform.rotate,
      base_width_m: this._tform.bw,
      base_height_m: this._tform.bh,
      x_move: this._tform.x,
      y_move: this._tform.y,
    };
    if (mode === "update") serviceData.device_hash = parseInt(this._editHash);

    const btn = this._q("send-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    this._setStatus("Sending to device…", "");
    this._setLoading(true);

    try {
      const resp = await this._hass.callService("mammotion", mode === "update" ? "svg_update" : "svg_add", serviceData, {}, false, true);
      const dHash = (resp.response || resp).device_hash;
      this._editHash = dHash ? String(dHash) : this._editHash;
      this._setStatus(`${mode === "update" ? "Updated" : "Added"} tile (hash: …${String(dHash || "").slice(-8)})`, "success");
      await this._refreshMap();
    } catch (err) {
      this._setStatus("Error: " + (err.message || err), "error");
    } finally {
      this._setLoading(false);
      if (btn) { btn.disabled = false; btn.textContent = "Send to Device"; }
    }
  }

  // ── Delete tile ───────────────────────────────────────────────────────────

  async _deleteTile(deviceHash, areaHash) {
    if (!confirm(`Delete tile …${deviceHash.slice(-8)} from area ${this._areaNames[areaHash] || areaHash.slice(-8)}?`)) return;

    this._setLoading(true);
    try {
      await this._hass.callService("mammotion", "svg_delete", {
        entity_id: this._entity,
        device_hash: parseInt(deviceHash),
        area_hash: parseInt(areaHash),
      }, {}, false, true);

      // Clear edit state if we just deleted the tile being edited
      if (this._editHash === deviceHash) {
        this._editHash = null;
        this._editAreaHash = null;
        this._setStatus("Tile deleted", "success");
      }
      await this._refreshMap();
    } catch (err) {
      this._setStatus("Delete failed: " + (err.message || err), "error");
    } finally {
      this._setLoading(false);
    }
  }

  // ── HA card lifecycle ─────────────────────────────────────────────────────

  static getConfigElement() {
    return document.createElement("div");
  }

  static getStubConfig() {
    return {};
  }

  disconnectedCallback() {
    document.removeEventListener("pointermove", this._boundPointerMove);
    document.removeEventListener("pointerup", this._boundPointerUp);
  }
}

customElements.define("mammotion-svg-card", MammotionSvgCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "mammotion-svg-card",
  name: "Mammotion SVG Map Aligner",
  description: "Position and send SVG pattern tiles to a Mammotion robot mower.",
  preview: false,
});
