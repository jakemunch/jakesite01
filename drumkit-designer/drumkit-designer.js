(function () {
  'use strict';

  // ---------- Render-scale constants ----------
  var PX_PER_INCH = 14;
  var GRID = 10;
  var STORAGE_KEY = 'drumkitDesignerLayout.v1';
  var SIDEBAR_WIDTH_KEY = 'drumkitDesignerSidebarWidth.v1';
  var SIDEBAR_MIN_W = 220;
  var SIDEBAR_MAX_W = 480;
  var CANVAS_MIN_W = 1400;
  var CANVAS_MIN_H = 900;

  // ---------- Inventory catalogs ----------
  var DRUM_TYPES = [
    { type: 'snare', name: 'Snare', defaultDiameter: 14, defaultDepth: 5.5, profile: false },
    { type: 'rackTom', name: 'Rack Tom', defaultDiameter: 12, defaultDepth: 9, profile: false },
    { type: 'floorTom', name: 'Floor Tom', defaultDiameter: 16, defaultDepth: 16, profile: false },
    { type: 'bassDrum', name: 'Bass Drum', defaultDiameter: 22, defaultDepth: 18, profile: true }
  ];
  var CYMBAL_TYPES = [
    { category: 'hihat', name: 'Hi-Hats', defaultDiameter: 14 },
    { category: 'ride', name: 'Ride', defaultDiameter: 20 },
    { category: 'crash', name: 'Crash', defaultDiameter: 16 },
    { category: 'china', name: 'China', defaultDiameter: 18 },
    { category: 'splash', name: 'Splash', defaultDiameter: 10 },
    { category: 'effectsA', name: 'Effects A', defaultDiameter: 12 },
    { category: 'effectsB', name: 'Effects B', defaultDiameter: 12 }
  ];
  var drumTypeByKey = {};
  DRUM_TYPES.forEach(function (t) { drumTypeByKey[t.type] = t; });
  var cymbalTypeByKey = {};
  CYMBAL_TYPES.forEach(function (t) { cymbalTypeByKey[t.category] = t; });

  // Shell color presets, offered as quick-pick swatches in the properties
  // panel (drums only -- heads stay their default color for now). A piece
  // with no shellColor (null) falls back to the .dd-s-shell CSS default.
  var SHELL_COLOR_PRESETS = [
    { name: 'Black', hex: '#1a1a1a' },
    { name: 'White', hex: '#f2f0ea' },
    { name: 'Natural Wood', hex: '#8a5a34' },
    { name: 'Red', hex: '#9b2f2f' },
    { name: 'Blue', hex: '#24507a' },
    { name: 'Green', hex: '#2f6b4a' },
    { name: 'Silver', hex: '#b7b9bb' },
    { name: 'Gold', hex: '#ad8a4d' },
    { name: 'Purple', hex: '#5b3a7a' }
  ];

  // ---------- DOM refs ----------
  var sidebarEl, canvasViewportEl, canvasEl;
  var undoBtn, exportBtn, importBtn, importInput, handednessBtn, snapBtn, kitNameInput, clearAllBtn;
  var panelEl = null;

  // ---------- App state ----------
  var state = null;
  var undoSnapshot = null;
  var pendingSnapshot = null;
  var lastSyncedSnapshot = null;
  var dragCtx = null;
  var topZCounter = 0;
  var snapEnabled = false;

  var panelState = null; // { kind, id }
  var panelEditSnapshot = null;

  // ================= Utilities =================

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function generateId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function snapToGrid(v) {
    return Math.round(v / GRID) * GRID;
  }

  function clampNum(v, min, max) {
    if (!Number.isFinite(v)) v = min;
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  }

  function clampInt(v, min, max) {
    return Math.round(clampNum(v, min, max));
  }

  function isValidHexColor(v) {
    return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  }

  // ================= Data model helpers =================

  function typeDef(kind, key) {
    return kind === 'drum' ? drumTypeByKey[key] : cymbalTypeByKey[key];
  }

  function keyOf(kind, piece) {
    return kind === 'drum' ? piece.type : piece.category;
  }

  function isProfile(kind, key) {
    var t = typeDef(kind, key);
    return kind === 'drum' && !!(t && t.profile);
  }

  function findPiece(kind, id) {
    var arr = kind === 'drum' ? state.drums : state.cymbals;
    return arr.find(function (p) { return p.id === id; }) || null;
  }

  function pushPiece(kind, piece) {
    if (kind === 'drum') state.drums.push(piece); else state.cymbals.push(piece);
  }

  function removePiece(kind, id) {
    if (kind === 'drum') state.drums = state.drums.filter(function (p) { return p.id !== id; });
    else state.cymbals = state.cymbals.filter(function (p) { return p.id !== id; });
  }

  function allPieces() {
    return state.drums.map(function (p) { return { kind: 'drum', piece: p }; })
      .concat(state.cymbals.map(function (p) { return { kind: 'cymbal', piece: p }; }));
  }

  function pieceToBox(kind, piece) {
    var key = keyOf(kind, piece);
    if (isProfile(kind, key)) {
      var w = piece.diameter * PX_PER_INCH;
      var h = piece.depth * PX_PER_INCH;
      return { left: piece.x - w / 2, top: piece.y - h / 2, w: w, h: h };
    }
    var d = piece.diameter * PX_PER_INCH;
    return { left: piece.x - d / 2, top: piece.y - d / 2, w: d, h: d };
  }

  function createPiece(kind, key, x, y) {
    topZCounter += 1;
    if (kind === 'drum') {
      var t = drumTypeByKey[key];
      return { id: generateId('drum'), type: key, label: '', diameter: t.defaultDiameter, depth: t.defaultDepth, shellColor: null, x: x, y: y, z: topZCounter };
    }
    var t2 = cymbalTypeByKey[key];
    return { id: generateId('cym'), category: key, label: '', diameter: t2.defaultDiameter, x: x, y: y, z: topZCounter };
  }

  function nextCascadeSpot() {
    var n = allPieces().length;
    var step = 24;
    var cols = 8;
    var offX = (n % cols) * step;
    var offY = Math.floor((n / cols) % cols) * step;
    return { x: 480 + offX, y: 380 + offY };
  }

  function recomputeTopZCounter() {
    var maxZ = 0;
    allPieces().forEach(function (item) { if (item.piece.z > maxZ) maxZ = item.piece.z; });
    topZCounter = maxZ;
  }

  // ================= Undo / change tracking =================
  // Single-level "toggle" undo, ported from Rack Builder: Ctrl/Cmd+Z (or the
  // toolbar button) swaps the current state with the one stored snapshot, so
  // pressing it again re-applies whatever it just undid.

  function beginChange() {
    pendingSnapshot = deepClone(state);
  }

  function commitChange() {
    undoSnapshot = pendingSnapshot;
    pendingSnapshot = null;
    state.modified = new Date().toISOString();
    render();
    autosave();
    updateUndoButton();
  }

  function applyMinorChange() {
    state.modified = new Date().toISOString();
    autosave();
  }

  function performUndo() {
    if (undoSnapshot === null) return;
    var current = deepClone(state);
    state = deepClone(undoSnapshot);
    undoSnapshot = current;
    render();
    autosave();
    updateUndoButton();
  }

  function updateUndoButton() {
    undoBtn.disabled = undoSnapshot === null;
  }

  // ================= Persistence =================

  function autosave() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) { /* storage unavailable/full - non-critical for a planning tool */ }
  }

  function normalizeImportedState(parsed) {
    var now = new Date().toISOString();

    var drums = Array.isArray(parsed.drums) ? parsed.drums.filter(function (d) {
      return d && typeof d.type === 'string' && drumTypeByKey[d.type];
    }).map(function (d) {
      var t = drumTypeByKey[d.type];
      return {
        id: typeof d.id === 'string' && d.id ? d.id : generateId('drum'),
        type: d.type,
        label: typeof d.label === 'string' ? d.label.trim() : '',
        diameter: Number.isFinite(d.diameter) ? d.diameter : t.defaultDiameter,
        depth: Number.isFinite(d.depth) ? d.depth : t.defaultDepth,
        shellColor: isValidHexColor(d.shellColor) ? d.shellColor.toLowerCase() : null,
        x: Number.isFinite(d.x) ? d.x : 500,
        y: Number.isFinite(d.y) ? d.y : 400,
        z: Number.isInteger(d.z) ? d.z : 0
      };
    }) : [];

    var cymbals = Array.isArray(parsed.cymbals) ? parsed.cymbals.filter(function (c) {
      return c && typeof c.category === 'string' && cymbalTypeByKey[c.category];
    }).map(function (c) {
      var t = cymbalTypeByKey[c.category];
      return {
        id: typeof c.id === 'string' && c.id ? c.id : generateId('cym'),
        category: c.category,
        label: typeof c.label === 'string' ? c.label.trim() : '',
        diameter: Number.isFinite(c.diameter) ? c.diameter : t.defaultDiameter,
        x: Number.isFinite(c.x) ? c.x : 500,
        y: Number.isFinite(c.y) ? c.y : 400,
        z: Number.isInteger(c.z) ? c.z : 0
      };
    }) : [];

    var all = drums.concat(cymbals);
    var maxZ = 0;
    all.forEach(function (p) { if (p.z > maxZ) maxZ = p.z; });
    all.forEach(function (p) { if (!p.z) { maxZ += 1; p.z = maxZ; } });

    return {
      version: 1,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Untitled Kit',
      created: typeof parsed.created === 'string' ? parsed.created : now,
      modified: now,
      handedness: parsed.handedness === 'left' ? 'left' : 'right',
      drums: drums,
      cymbals: cymbals
    };
  }

  function defaultState() {
    var now = new Date().toISOString();
    return { version: 1, name: 'Untitled Kit', created: now, modified: now, handedness: 'right', drums: [], cymbals: [] };
  }

  function loadInitialState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && (Array.isArray(parsed.drums) || Array.isArray(parsed.cymbals))) return normalizeImportedState(parsed);
      }
    } catch (err) { /* ignore corrupt storage, fall back to default */ }
    return defaultState();
  }

  function hasUnsavedChanges() {
    if (lastSyncedSnapshot === null) return state.drums.length > 0 || state.cymbals.length > 0;
    return JSON.stringify(state) !== lastSyncedSnapshot;
  }

  // ================= Stencil rendering =================
  // All stencils are generated SVG (not photos) since diameter/depth are
  // freeform user-typed numbers -- there's no fixed-size photo that could
  // ever match an arbitrary size. Geometry is authored in a normalized
  // viewBox and stretched to fit the actual pixel box via preserveAspectRatio
  //="none", so the same markup works at any diameter.

  // shellColor is either null (use the .dd-s-shell CSS default) or a
  // pre-validated "#rrggbb" string (see isValidHexColor) -- callers must
  // validate before this point, since it's concatenated directly into markup.
  function shellStyleAttr(shellColor) {
    return shellColor ? ' style="fill:' + shellColor + '"' : '';
  }

  function drumOverheadSvg(shellColor) {
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="48" class="dd-s-shell"' + shellStyleAttr(shellColor) + '/>' +
      '<circle cx="50" cy="50" r="40" class="dd-s-head"/>' +
      '</svg>';
  }

  function bassProfileSvg(shellColor) {
    // Side-elevation icon: the shell's diameter runs left-right (its sides
    // face the sides of the page) and the depth (front/back head-to-head
    // axis) runs top-bottom, so the rim strokes sit on the top and bottom
    // edges rather than the left and right.
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<rect x="3" y="3" width="94" height="94" rx="4" class="dd-s-shell"' + shellStyleAttr(shellColor) + '/>' +
      '<line x1="3" y1="15" x2="97" y2="15" class="dd-s-rim"/>' +
      '<line x1="3" y1="85" x2="97" y2="85" class="dd-s-rim"/>' +
      '</svg>';
  }

  function hihatSvg() {
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<circle cx="53" cy="53" r="44" class="dd-s-cym-under"/>' +
      '<circle cx="47" cy="47" r="44" class="dd-s-cym-top"/>' +
      '<circle cx="47" cy="47" r="13" class="dd-s-bell"/>' +
      '</svg>';
  }

  function rideSvg() {
    // Solid filled bell distinguishes the ride from crash/splash/china/effects,
    // which use a hollow bell ring instead.
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="48" class="dd-s-cym"/>' +
      '<circle cx="50" cy="50" r="10" class="dd-s-bell"/>' +
      '</svg>';
  }

  function crashSvg() {
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="48" class="dd-s-cym"/>' +
      '<circle cx="50" cy="50" r="9" class="dd-s-bell-ring"/>' +
      '</svg>';
  }

  function chinaSvg() {
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="48" class="dd-s-cym"/>' +
      '<circle cx="50" cy="50" r="34" class="dd-s-groove"/>' +
      '<circle cx="50" cy="50" r="9" class="dd-s-bell-ring"/>' +
      '</svg>';
  }

  function circleSubpath(cx, cy, r) {
    // Two-arc form of a circle, usable as one closed subpath inside a larger
    // compound <path> -- combined with fill-rule="evenodd" this lets several
    // circles cut genuine transparent holes through a single filled shape.
    return 'M' + cx + ',' + (cy - r) +
      ' A' + r + ',' + r + ' 0 1,0 ' + cx + ',' + (cy + r) +
      ' A' + r + ',' + r + ' 0 1,0 ' + cx + ',' + (cy - r) + ' Z ';
  }

  function roundedPolygonPath(cx, cy, r, sides, cornerFrac, rotationOffset) {
    var verts = [];
    for (var i = 0; i < sides; i++) {
      var angle = rotationOffset + (Math.PI * 2 * i / sides);
      verts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
    }
    var d = '';
    for (var i = 0; i < sides; i++) {
      var curr = verts[i];
      var prev = verts[(i - 1 + sides) % sides];
      var next = verts[(i + 1) % sides];
      var aIn = { x: curr.x + (prev.x - curr.x) * cornerFrac, y: curr.y + (prev.y - curr.y) * cornerFrac };
      var bOut = { x: curr.x + (next.x - curr.x) * cornerFrac, y: curr.y + (next.y - curr.y) * cornerFrac };
      d += (i === 0 ? 'M' : 'L') + aIn.x.toFixed(1) + ' ' + aIn.y.toFixed(1) + ' ';
      d += 'Q' + curr.x.toFixed(1) + ' ' + curr.y.toFixed(1) + ' ' + bOut.x.toFixed(1) + ' ' + bOut.y.toFixed(1) + ' ';
    }
    return d + 'Z';
  }

  function effectsASvg() {
    // Soft-cornered octagon, after the Sabian AA Rocktagon.
    var d = roundedPolygonPath(50, 50, 46, 8, 0.15, -Math.PI / 2);
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" class="dd-s-cym"/>' +
      '<circle cx="50" cy="50" r="9" class="dd-s-bell-ring"/>' +
      '</svg>';
  }

  function effectsBSvg() {
    // A ring of round cutouts through the face, after the Sabian HHX
    // Evolution O-Zone -- built as one compound path so the holes are true
    // transparency (whatever's behind the piece shows through), not just a
    // hardcoded background color.
    var d = circleSubpath(50, 50, 48);
    var holes = 8, holeR = 6, holeDist = 33;
    for (var i = 0; i < holes; i++) {
      var angle = (Math.PI * 2 * i / holes) - Math.PI / 2;
      d += circleSubpath(50 + holeDist * Math.cos(angle), 50 + holeDist * Math.sin(angle), holeR);
    }
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + d + '" fill-rule="evenodd" class="dd-s-cym"/>' +
      '<circle cx="50" cy="50" r="9" class="dd-s-bell-ring"/>' +
      '</svg>';
  }

  function cymbalStencilSvg(category) {
    if (category === 'hihat') return hihatSvg();
    if (category === 'ride') return rideSvg();
    if (category === 'china') return chinaSvg();
    if (category === 'effectsA') return effectsASvg();
    if (category === 'effectsB') return effectsBSvg();
    return crashSvg(); // crash + splash share the same treatment; size is the differentiator
  }

  function renderStencil(kind, key, shellColor) {
    if (kind === 'drum') return isProfile(kind, key) ? bassProfileSvg(shellColor) : drumOverheadSvg(shellColor);
    return cymbalStencilSvg(key);
  }

  // ================= Rendering =================

  function render() {
    renderCanvas();
    updateHandednessButton();
    updateSnapButton();
  }

  function fitCanvasToContent() {
    var maxX = CANVAS_MIN_W, maxY = CANVAS_MIN_H;
    allPieces().forEach(function (item) {
      var box = pieceToBox(item.kind, item.piece);
      maxX = Math.max(maxX, box.left + box.w + 400);
      maxY = Math.max(maxY, box.top + box.h + 400);
    });
    canvasEl.style.width = maxX + 'px';
    canvasEl.style.height = maxY + 'px';
  }

  function expandCanvasIfNeeded(right, bottom) {
    var margin = 400;
    var neededW = right + margin, neededH = bottom + margin;
    var curW = parseInt(canvasEl.style.width, 10) || canvasEl.offsetWidth;
    var curH = parseInt(canvasEl.style.height, 10) || canvasEl.offsetHeight;
    if (neededW > curW) canvasEl.style.width = neededW + 'px';
    if (neededH > curH) canvasEl.style.height = neededH + 'px';
  }

  function buildPieceEl(kind, piece) {
    var key = keyOf(kind, piece);
    var t = typeDef(kind, key);
    var profile = isProfile(kind, key);
    var el = document.createElement('div');
    el.className = 'dd-piece dd-piece-' + kind + (profile ? ' dd-piece-profile' : '');
    el.dataset.kind = kind;
    el.dataset.id = piece.id;
    var box = pieceToBox(kind, piece);
    el.style.left = box.left + 'px';
    el.style.top = box.top + 'px';
    el.style.width = box.w + 'px';
    el.style.height = box.h + 'px';
    el.style.zIndex = String(piece.z || 0);
    if (panelState && panelState.kind === kind && panelState.id === piece.id) el.classList.add('dd-piece-selected');
    el.innerHTML =
      '<div class="dd-piece-stencil">' + renderStencil(kind, key, piece.shellColor) + '</div>' +
      '<textarea class="dd-piece-label" placeholder="' + escapeHtml(t ? t.name : '') + '" aria-label="Label" rows="1">' + escapeHtml(piece.label || '') + '</textarea>';
    return el;
  }

  // Textareas don't grow with their content on their own -- re-measure and
  // reset the height to the content's natural height so long, wrapped labels
  // expand instead of scrolling or clipping.
  function autoSizeLabel(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  function renderCanvas() {
    canvasEl.innerHTML = '';
    allPieces().forEach(function (item) {
      canvasEl.appendChild(buildPieceEl(item.kind, item.piece));
    });
    canvasEl.querySelectorAll('.dd-piece-label').forEach(autoSizeLabel);
    fitCanvasToContent();
  }

  function renderPieceEl(kind, id) {
    var piece = findPiece(kind, id);
    if (!piece) return;
    var el = canvasEl.querySelector('.dd-piece[data-kind="' + kind + '"][data-id="' + id + '"]');
    if (!el) return;
    var box = pieceToBox(kind, piece);
    el.style.left = box.left + 'px';
    el.style.top = box.top + 'px';
    el.style.width = box.w + 'px';
    el.style.height = box.h + 'px';
    var stencilWrap = el.querySelector('.dd-piece-stencil');
    if (stencilWrap) stencilWrap.innerHTML = renderStencil(kind, keyOf(kind, piece), piece.shellColor);
    var labelInput = el.querySelector('.dd-piece-label');
    if (labelInput && document.activeElement !== labelInput) labelInput.value = piece.label || '';
    if (labelInput) autoSizeLabel(labelInput);
    expandCanvasIfNeeded(box.left + box.w, box.top + box.h);
  }

  function bringPieceToFront(kind, id, el) {
    var piece = findPiece(kind, id);
    if (!piece) return;
    topZCounter += 1;
    piece.z = topZCounter;
    if (el) el.style.zIndex = String(piece.z);
    applyMinorChange();
  }

  // ================= Sidebar / inventory =================

  function buildInventoryRow(kind, def) {
    var key = kind === 'drum' ? def.type : def.category;
    var row = document.createElement('div');
    row.className = 'dd-inv-row';
    row.dataset.kind = kind;
    row.dataset.key = key;
    var meta = kind === 'drum'
      ? (def.defaultDiameter + '" × ' + def.defaultDepth + '"')
      : (def.defaultDiameter + '" cymbal');
    row.innerHTML =
      '<span class="dd-inv-thumb">' + renderStencil(kind, key) + '</span>' +
      '<span class="dd-inv-info">' +
        '<span class="dd-inv-name">' + escapeHtml(def.name) + '</span>' +
        '<span class="dd-inv-meta">' + escapeHtml(meta) + '</span>' +
      '</span>' +
      '<span class="dd-inv-qty">' +
        '<input type="number" class="dd-inv-qty-input" value="1" min="1" max="12" aria-label="Quantity to add">' +
        '<button type="button" class="dd-inv-add" title="Add" aria-label="Add">+</button>' +
      '</span>';
    return row;
  }

  function buildSidebar() {
    var drumList = document.getElementById('dd-drum-list');
    var cymbalList = document.getElementById('dd-cymbal-list');
    DRUM_TYPES.forEach(function (t) { drumList.appendChild(buildInventoryRow('drum', t)); });
    CYMBAL_TYPES.forEach(function (t) { cymbalList.appendChild(buildInventoryRow('cymbal', t)); });
  }

  function addFromInventoryRow(row, qty) {
    var kind = row.dataset.kind, key = row.dataset.key;
    beginChange();
    var lastId = null;
    for (var i = 0; i < qty; i++) {
      var pos = nextCascadeSpot();
      var piece = createPiece(kind, key, pos.x, pos.y);
      pushPiece(kind, piece);
      lastId = piece.id;
    }
    commitChange();
    openPanelFor(kind, lastId);
  }

  // ================= Properties panel =================

  function ensurePanelEl() {
    if (panelEl) return;
    panelEl = document.createElement('div');
    panelEl.className = 'dd-panel';
    panelEl.style.display = 'none';
    document.body.appendChild(panelEl);
  }

  function buildFieldRow(labelText, inputEl) {
    var row = document.createElement('label');
    row.className = 'dd-field-row';
    var span = document.createElement('span');
    span.className = 'dd-field-label';
    span.textContent = labelText;
    row.appendChild(span);
    row.appendChild(inputEl);
    return row;
  }

  function buildTextInput(value, onInput) {
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dd-field-input';
    input.value = value;
    input.addEventListener('input', function () { onInput(input.value); });
    return input;
  }

  function buildNumberInput(value, min, max, step, onInput) {
    var input = document.createElement('input');
    input.type = 'number';
    input.className = 'dd-field-input';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      if (Number.isFinite(v)) onInput(clampNum(v, min, max));
    });
    return input;
  }

  function buildShellColorField(piece, kind, id) {
    var row = document.createElement('div');
    row.className = 'dd-field-row';
    var label = document.createElement('span');
    label.className = 'dd-field-label';
    label.textContent = 'Shell Color';
    row.appendChild(label);

    var grid = document.createElement('div');
    grid.className = 'dd-swatch-grid';

    var defaultBtn = document.createElement('button');
    defaultBtn.type = 'button';
    defaultBtn.className = 'dd-swatch dd-swatch-default' + (!piece.shellColor ? ' dd-swatch-selected' : '');
    defaultBtn.title = 'Default';
    defaultBtn.setAttribute('aria-label', 'Default shell color');
    defaultBtn.addEventListener('click', function () {
      piece.shellColor = null;
      renderPieceEl(kind, id);
      renderPanel();
    });
    grid.appendChild(defaultBtn);

    SHELL_COLOR_PRESETS.forEach(function (preset) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dd-swatch' + (piece.shellColor === preset.hex ? ' dd-swatch-selected' : '');
      btn.style.background = preset.hex;
      btn.title = preset.name;
      btn.setAttribute('aria-label', preset.name);
      btn.addEventListener('click', function () {
        piece.shellColor = preset.hex;
        renderPieceEl(kind, id);
        renderPanel();
      });
      grid.appendChild(btn);
    });

    var customInput = document.createElement('input');
    customInput.type = 'color';
    customInput.className = 'dd-swatch dd-swatch-custom';
    customInput.title = 'Custom color';
    customInput.setAttribute('aria-label', 'Custom shell color');
    customInput.value = isValidHexColor(piece.shellColor) ? piece.shellColor : '#2a2723';
    customInput.addEventListener('input', function () {
      piece.shellColor = customInput.value;
      renderPieceEl(kind, id);
    });
    customInput.addEventListener('change', function () {
      piece.shellColor = customInput.value;
      renderPieceEl(kind, id);
      renderPanel();
    });
    grid.appendChild(customInput);

    row.appendChild(grid);
    return row;
  }

  function renderPanel() {
    ensurePanelEl();
    var kind = panelState.kind, id = panelState.id;
    var piece = findPiece(kind, id);
    if (!piece) { panelState = null; panelEl.style.display = 'none'; return; }
    var key = keyOf(kind, piece);
    var t = typeDef(kind, key);

    panelEl.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'dd-panel-header';
    var titleSpan = document.createElement('span');
    titleSpan.textContent = t ? t.name : 'Piece';
    header.appendChild(titleSpan);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'dd-panel-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', function () { closePanel(false); });
    header.appendChild(closeBtn);
    panelEl.appendChild(header);

    var body = document.createElement('div');
    body.className = 'dd-panel-body';
    body.appendChild(buildFieldRow('Label', buildTextInput(piece.label || '', function (v) {
      piece.label = v;
      renderPieceEl(kind, id);
    })));
    body.appendChild(buildFieldRow('Diameter (in)', buildNumberInput(piece.diameter, 4, 26, 0.5, function (v) {
      piece.diameter = v;
      renderPieceEl(kind, id);
    })));
    if (kind === 'drum') {
      body.appendChild(buildFieldRow('Depth (in)', buildNumberInput(piece.depth, 3, 22, 0.5, function (v) {
        piece.depth = v;
        renderPieceEl(kind, id);
      })));
      body.appendChild(buildShellColorField(piece, kind, id));
    }
    panelEl.appendChild(body);

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'dd-panel-delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', function () {
      state = panelEditSnapshot;
      panelEditSnapshot = null;
      panelState = null;
      panelEl.style.display = 'none';
      beginChange();
      removePiece(kind, id);
      commitChange();
    });
    panelEl.appendChild(delBtn);

    panelEl.style.display = 'block';
  }

  function positionPanelNear(anchorEl) {
    ensurePanelEl();
    var rect = anchorEl.getBoundingClientRect();
    panelEl.style.visibility = 'hidden';
    panelEl.style.display = 'block';
    var pw = panelEl.offsetWidth, ph = panelEl.offsetHeight;
    var toolbarEl = document.querySelector('.dd-toolbar');
    var minY = (toolbarEl ? toolbarEl.getBoundingClientRect().bottom : 0) + 8;
    var x = rect.right + 12;
    if (x + pw > window.innerWidth - 8) x = rect.left - pw - 12;
    x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));
    var y = Math.max(minY, Math.min(rect.top, window.innerHeight - ph - 8));
    panelEl.style.left = x + 'px';
    panelEl.style.top = y + 'px';
    panelEl.style.visibility = 'visible';
  }

  function openPanelFor(kind, id) {
    panelEditSnapshot = deepClone(state);
    panelState = { kind: kind, id: id };
    renderPanel();
    var el = canvasEl.querySelector('.dd-piece[data-kind="' + kind + '"][data-id="' + id + '"]');
    if (el) {
      el.classList.add('dd-piece-selected');
      positionPanelNear(el);
    }
  }

  function closePanel(revert) {
    if (!panelState) return;
    if (revert) {
      state = panelEditSnapshot;
      panelEditSnapshot = null;
      panelState = null;
      panelEl.style.display = 'none';
      render();
      return;
    }
    var changed = JSON.stringify(state) !== JSON.stringify(panelEditSnapshot);
    panelState = null;
    panelEl.style.display = 'none';
    if (changed) {
      pendingSnapshot = panelEditSnapshot;
      panelEditSnapshot = null;
      commitChange();
    } else {
      panelEditSnapshot = null;
      render();
    }
  }

  // ================= Mirror (handedness) toggle =================

  function toggleHandedness() {
    var pieces = allPieces();
    if (!pieces.length) {
      state.handedness = state.handedness === 'left' ? 'right' : 'left';
      applyMinorChange();
      updateHandednessButton();
      return;
    }
    var xs = pieces.map(function (item) { return item.piece.x; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var axis = (minX + maxX) / 2;
    beginChange();
    pieces.forEach(function (item) { item.piece.x = 2 * axis - item.piece.x; });
    state.handedness = state.handedness === 'left' ? 'right' : 'left';
    commitChange();
  }

  function updateHandednessButton() {
    if (!handednessBtn) return;
    handednessBtn.textContent = state.handedness === 'left' ? '⇄ Left-Handed' : '⇄ Right-Handed';
    handednessBtn.setAttribute('aria-pressed', String(state.handedness === 'left'));
  }

  // ================= Snap-to-grid toggle =================

  function toggleSnap() {
    snapEnabled = !snapEnabled;
    updateSnapButton();
  }

  function updateSnapButton() {
    if (!snapBtn) return;
    snapBtn.setAttribute('aria-pressed', String(snapEnabled));
    snapBtn.classList.toggle('dd-btn-active', snapEnabled);
    canvasEl.classList.toggle('dd-grid-on', snapEnabled);
  }

  // ================= Drag: shared helpers =================

  function setBodyNoSelect(on) {
    document.body.style.userSelect = on ? 'none' : '';
    document.body.style.webkitUserSelect = on ? 'none' : '';
  }

  function isPointOverSidebar(x, y) {
    var rect = sidebarEl.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function positionGhost(ghost, x, y, w, h) {
    ghost.style.left = (x - w / 2) + 'px';
    ghost.style.top = (y - h / 2) + 'px';
  }

  // ================= Drag: placed piece (move / remove) =================

  function startPlacedDrag(e, pieceEl) {
    var kind = pieceEl.dataset.kind, id = pieceEl.dataset.id;
    var piece = findPiece(kind, id);
    if (!piece) return;
    var box0 = pieceToBox(kind, piece);
    dragCtx = {
      type: 'placed', kind: kind, id: id, pieceEl: pieceEl,
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      startCenterX: piece.x, startCenterY: piece.y,
      w: box0.w, h: box0.h,
      started: false
    };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  function movePlacedDrag(e) {
    var dx = e.clientX - dragCtx.startX, dy = e.clientY - dragCtx.startY;
    var nx = dragCtx.startCenterX + dx, ny = dragCtx.startCenterY + dy;
    if (snapEnabled) { nx = snapToGrid(nx); ny = snapToGrid(ny); }
    dragCtx.newX = nx; dragCtx.newY = ny;
    dragCtx.pieceEl.style.left = (nx - dragCtx.w / 2) + 'px';
    dragCtx.pieceEl.style.top = (ny - dragCtx.h / 2) + 'px';
    expandCanvasIfNeeded(nx + dragCtx.w / 2, ny + dragCtx.h / 2);
  }

  function finishPlacedDrag(e) {
    setBodyNoSelect(false);
    dragCtx.pieceEl.classList.remove('dd-piece-dragging');
    var kind = dragCtx.kind, id = dragCtx.id;

    if (dragCtx.started && isPointOverSidebar(e.clientX, e.clientY)) {
      beginChange();
      removePiece(kind, id);
      commitChange();
      if (panelState && panelState.kind === kind && panelState.id === id) {
        panelState = null;
        panelEditSnapshot = null;
        if (panelEl) panelEl.style.display = 'none';
      }
      return;
    }

    if (dragCtx.started) {
      var piece = findPiece(kind, id);
      if (piece) {
        beginChange();
        piece.x = dragCtx.newX;
        piece.y = dragCtx.newY;
        commitChange();
      }
      // A real drag just repositions the piece -- don't pop the properties
      // panel open on top of/next to it, which only gets in the way of the
      // next drag. A plain click (no movement) still opens it, below.
      return;
    }
    openPanelFor(kind, id);
  }

  // ================= Drag: piece from inventory (add / place) =================

  function startLibraryDrag(e, rowEl) {
    dragCtx = {
      type: 'library', kind: rowEl.dataset.kind, key: rowEl.dataset.key, rowEl: rowEl,
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      started: false
    };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  function ghostBoxForDefault(kind, key) {
    var t = typeDef(kind, key);
    if (kind === 'drum' && t.profile) return { w: t.defaultDiameter * PX_PER_INCH, h: t.defaultDepth * PX_PER_INCH };
    var d = t.defaultDiameter * PX_PER_INCH;
    return { w: d, h: d };
  }

  function createLibraryGhost(kind, key, x, y) {
    var box = ghostBoxForDefault(kind, key);
    var ghost = document.createElement('div');
    ghost.className = 'dd-drag-ghost';
    ghost.style.width = box.w + 'px';
    ghost.style.height = box.h + 'px';
    ghost.innerHTML = renderStencil(kind, key);
    document.body.appendChild(ghost);
    dragCtx.ghostEl = ghost;
    dragCtx.ghostW = box.w;
    dragCtx.ghostH = box.h;
    positionGhost(ghost, x, y, box.w, box.h);
  }

  function finishLibraryDrag(e) {
    setBodyNoSelect(false);
    if (dragCtx.rowEl) dragCtx.rowEl.classList.remove('dd-dragging-source');
    if (dragCtx.ghostEl) dragCtx.ghostEl.remove();

    var kind = dragCtx.kind, key = dragCtx.key;
    var pos;
    if (dragCtx.started) {
      if (isPointOverSidebar(e.clientX, e.clientY)) return; // dropped back on sidebar -- cancel, add nothing
      var canvasRect = canvasEl.getBoundingClientRect();
      pos = { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top };
      if (snapEnabled) { pos.x = snapToGrid(pos.x); pos.y = snapToGrid(pos.y); }
    } else {
      pos = nextCascadeSpot();
    }
    beginChange();
    var piece = createPiece(kind, key, pos.x, pos.y);
    pushPiece(kind, piece);
    commitChange();
    // Same reasoning as finishPlacedDrag: only auto-open the panel for a
    // plain click-to-add, not a drag-to-place, so the panel never lands in
    // the way of a follow-up drag.
    if (!dragCtx.started) openPanelFor(kind, piece.id);
  }

  // ================= Drag: sidebar resize =================

  function startSidebarResizeDrag(e, handleEl) {
    handleEl.classList.add('dd-resizing');
    setBodyNoSelect(true);
    dragCtx = {
      type: 'sidebar-resize', handleEl: handleEl,
      startX: e.clientX,
      startWidth: sidebarEl.getBoundingClientRect().width
    };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  function moveSidebarResizeDrag(e) {
    var w = dragCtx.startWidth + (e.clientX - dragCtx.startX);
    w = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, w));
    sidebarEl.style.width = w + 'px';
  }

  function finishSidebarResizeDrag() {
    dragCtx.handleEl.classList.remove('dd-resizing');
    setBodyNoSelect(false);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarEl.getBoundingClientRect().width)));
    } catch (err) { /* non-critical */ }
  }

  // ================= Drag dispatch =================

  function onDragMove(e) {
    if (!dragCtx) return;
    if (dragCtx.type === 'placed') {
      if (!dragCtx.started) {
        var dx = e.clientX - dragCtx.startX, dy = e.clientY - dragCtx.startY;
        if (Math.hypot(dx, dy) < 4) return;
        dragCtx.started = true;
        setBodyNoSelect(true);
        dragCtx.pieceEl.classList.add('dd-piece-dragging');
      }
      movePlacedDrag(e);
    } else if (dragCtx.type === 'library') {
      if (!dragCtx.started) {
        var dx2 = e.clientX - dragCtx.startX, dy2 = e.clientY - dragCtx.startY;
        if (Math.hypot(dx2, dy2) < 4) return;
        dragCtx.started = true;
        setBodyNoSelect(true);
        dragCtx.rowEl.classList.add('dd-dragging-source');
        createLibraryGhost(dragCtx.kind, dragCtx.key, e.clientX, e.clientY);
      }
      positionGhost(dragCtx.ghostEl, e.clientX, e.clientY, dragCtx.ghostW, dragCtx.ghostH);
    } else if (dragCtx.type === 'sidebar-resize') {
      moveSidebarResizeDrag(e);
    }
  }

  function onDragEnd(e) {
    if (!dragCtx) return;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);

    var type = dragCtx.type;
    if (type === 'placed') finishPlacedDrag(e);
    else if (type === 'library') finishLibraryDrag(e);
    else if (type === 'sidebar-resize') finishSidebarResizeDrag();

    dragCtx = null;
  }

  function cancelActiveDrag() {
    if (!dragCtx) return;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);

    setBodyNoSelect(false);
    if (dragCtx.ghostEl) dragCtx.ghostEl.remove();
    if (dragCtx.pieceEl) dragCtx.pieceEl.classList.remove('dd-piece-dragging');
    if (dragCtx.rowEl) dragCtx.rowEl.classList.remove('dd-dragging-source');
    if (dragCtx.handleEl) dragCtx.handleEl.classList.remove('dd-resizing');
    if (dragCtx.type === 'sidebar-resize') sidebarEl.style.width = dragCtx.startWidth + 'px';

    var wasPlacedOrLibrary = dragCtx.type === 'placed' || dragCtx.type === 'library';
    dragCtx = null;
    if (wasPlacedOrLibrary) render();
  }

  // ================= Clear all =================

  function doClearAll() {
    if (!state.drums.length && !state.cymbals.length) return;
    var ok = window.confirm('Delete all drums and cymbals and start over? You can undo this with the Undo button right after.');
    if (!ok) return;
    if (panelState) {
      panelState = null;
      panelEditSnapshot = null;
      if (panelEl) panelEl.style.display = 'none';
    }
    beginChange();
    state.drums = [];
    state.cymbals = [];
    commitChange();
    topZCounter = 0;
  }

  // ================= Import / export =================

  function doExport() {
    var dataStr = JSON.stringify(state, null, 2);
    var blob = new Blob([dataStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var dateStr = new Date().toISOString().slice(0, 10);
    var safeName = (state.name || 'kit').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.href = url;
    a.download = (safeName || 'drum-kit') + '-' + dateStr + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    lastSyncedSnapshot = JSON.stringify(state);
  }

  function doImportClick() {
    if (hasUnsavedChanges()) {
      var ok = window.confirm('Your current kit hasn\'t been exported. Importing a file will replace the entire workspace. Continue?');
      if (!ok) return;
    }
    importInput.click();
  }

  function doImportFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || (!Array.isArray(parsed.drums) && !Array.isArray(parsed.cymbals))) {
          throw new Error('This file doesn\'t look like a Drumkit Designer layout.');
        }
        state = normalizeImportedState(parsed);
        undoSnapshot = null;
        recomputeTopZCounter();
        lastSyncedSnapshot = JSON.stringify(state);
        kitNameInput.value = state.name;
        render();
        autosave();
        updateUndoButton();
      } catch (err) {
        window.alert('Could not import layout: ' + err.message);
      } finally {
        importInput.value = '';
      }
    };
    reader.readAsText(file);
  }

  // ================= Event wiring =================

  function cacheDom() {
    sidebarEl = document.querySelector('.dd-sidebar');
    canvasViewportEl = document.getElementById('dd-canvas-viewport');
    canvasEl = document.getElementById('dd-canvas');
    undoBtn = document.getElementById('dd-undo');
    exportBtn = document.getElementById('dd-export');
    importBtn = document.getElementById('dd-import-btn');
    importInput = document.getElementById('dd-import-input');
    handednessBtn = document.getElementById('dd-handedness');
    snapBtn = document.getElementById('dd-snap');
    kitNameInput = document.getElementById('dd-kit-name');
    clearAllBtn = document.getElementById('dd-clear-all');
  }

  function wireEvents() {
    document.addEventListener('pointerdown', function (e) {
      if (dragCtx) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;

      if (panelState && !e.target.closest('.dd-panel')) closePanel(false);

      if (e.target.closest('.dd-inv-qty')) return;

      var sidebarResizeHandle = e.target.closest('.dd-sidebar-resize');
      if (sidebarResizeHandle) { e.preventDefault(); startSidebarResizeDrag(e, sidebarResizeHandle); return; }

      var invRow = e.target.closest('.dd-inv-row');
      if (invRow) { e.preventDefault(); startLibraryDrag(e, invRow); return; }

      var pieceEl = e.target.closest('.dd-piece');
      if (pieceEl) {
        bringPieceToFront(pieceEl.dataset.kind, pieceEl.dataset.id, pieceEl);
        if (!e.target.closest('.dd-piece-label')) {
          e.preventDefault();
          startPlacedDrag(e, pieceEl);
        }
        return;
      }
    });

    document.addEventListener('click', function (e) {
      var addBtn = e.target.closest('.dd-inv-add');
      if (addBtn) {
        var row = addBtn.closest('.dd-inv-row');
        var qtyInput = row.querySelector('.dd-inv-qty-input');
        var qty = clampInt(parseInt(qtyInput.value, 10) || 1, 1, 12);
        addFromInventoryRow(row, qty);
      }
    });

    document.addEventListener('focusout', function (e) {
      if (e.target === kitNameInput) {
        var v = kitNameInput.value.trim() || 'Untitled Kit';
        if (v !== state.name) { state.name = v; applyMinorChange(); } else kitNameInput.value = state.name;
        return;
      }

      var labelInput = e.target.closest ? e.target.closest('.dd-piece-label') : null;
      if (labelInput) {
        var pieceEl = labelInput.closest('.dd-piece');
        if (!pieceEl) return;
        var kind = pieceEl.dataset.kind, id = pieceEl.dataset.id;
        var piece = findPiece(kind, id);
        if (!piece) return;
        var newLabel = labelInput.value.trim();
        if (newLabel !== (piece.label || '')) {
          piece.label = newLabel;
          applyMinorChange();
          if (panelState && panelState.kind === kind && panelState.id === id) renderPanel();
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dragCtx) { cancelActiveDrag(); return; }
      if (e.key === 'Escape' && panelState) { closePanel(true); return; }
      if ((e.target.matches('.dd-piece-label') || e.target === kitNameInput) && e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; }
      if (e.target.matches('input, textarea, select')) return;
      var isUndo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
      if (isUndo) { e.preventDefault(); performUndo(); }
    });

    document.addEventListener('input', function (e) {
      var labelInput = e.target.closest ? e.target.closest('.dd-piece-label') : null;
      if (labelInput) autoSizeLabel(labelInput);
    });

    undoBtn.addEventListener('click', performUndo);
    exportBtn.addEventListener('click', doExport);
    importBtn.addEventListener('click', doImportClick);
    importInput.addEventListener('change', function () {
      var file = importInput.files[0];
      if (file) doImportFile(file);
    });
    handednessBtn.addEventListener('click', toggleHandedness);
    snapBtn.addEventListener('click', toggleSnap);
    clearAllBtn.addEventListener('click', doClearAll);

    canvasViewportEl.addEventListener('scroll', function () {
      if (panelState) closePanel(false);
    });
  }

  // ================= Init =================

  function loadSidebarWidth() {
    try {
      var raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      var w = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(w)) {
        sidebarEl.style.width = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, w)) + 'px';
      }
    } catch (err) { /* ignore, use default width */ }
  }

  function init() {
    cacheDom();
    loadSidebarWidth();
    buildSidebar();
    state = loadInitialState();
    recomputeTopZCounter();
    lastSyncedSnapshot = null;
    kitNameInput.value = state.name;
    wireEvents();
    render();
    updateUndoButton();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
