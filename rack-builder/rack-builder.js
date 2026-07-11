(function () {
  'use strict';

  // ---------- Render-scale constants (see rack-planner-spec.md Image Specifications) ----------
  var U_PX = 72;
  var FULL_W = 380;
  var HALF_W = 190;
  var RAIL_W = 28;
  var LABEL_W = 18;
  var GRID = 20;
  var STORAGE_KEY = 'rackBuilderLayout.v1';

  var CATEGORY_COLORS = {
    wireless: '#4a90d9',
    audio: '#2a6b5a',
    power: '#c0622e',
    fx: '#9b59b6',
    misc: '#8a8a8a'
  };
  var CATEGORY_LABELS = {
    wireless: 'Wireless',
    audio: 'Audio',
    power: 'Power',
    fx: 'FX',
    misc: 'Misc'
  };

  // ---------- DOM refs ----------
  var sidebarEl, gearListEl, searchInput, filterPillsEl;
  var canvasViewportEl, canvasEl;
  var addRackBtn, undoBtn, exportBtn, importBtn, importInput;

  // ---------- App state ----------
  var gearCatalog = [];
  var gearById = {};
  var gearLoadError = null;

  var state = null;
  var undoSnapshot = null;
  var pendingSnapshot = null;
  var lastSyncedSnapshot = null;
  var filterState = { search: '', category: 'all' };
  var dragCtx = null;

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

  // ================= Data model helpers =================

  function computeOccupancy(rack, excludeSlot) {
    var occ = {};
    for (var u = 1; u <= rack.uHeight; u++) occ[u] = { full: null, left: null, right: null };
    rack.slots.forEach(function (slot) {
      if (excludeSlot && slot.uPosition === excludeSlot.uPosition && slot.position === excludeSlot.position) return;
      var gear = gearById[slot.gearId];
      if (!gear) return;
      for (var i = 0; i < gear.uHeight; i++) {
        var u2 = slot.uPosition + i;
        if (occ[u2]) occ[u2][slot.position] = slot.gearId;
      }
    });
    return occ;
  }

  function canPlace(rackId, uPosition, position, gear, excludeSlot) {
    var rack = state.racks.find(function (r) { return r.id === rackId; });
    if (!rack || !gear) return false;
    var topU = uPosition;
    var botU = uPosition + gear.uHeight - 1;
    if (topU < 1 || botU > rack.uHeight) return false;
    var occ = computeOccupancy(rack, excludeSlot && excludeSlot.rackId === rackId ? excludeSlot : null);
    for (var u = topU; u <= botU; u++) {
      var cell = occ[u];
      if (!cell) return false;
      if (position === 'full') {
        if (cell.full || cell.left || cell.right) return false;
      } else {
        if (cell.full) return false;
        if (cell[position]) return false;
      }
    }
    return true;
  }

  function lowestRequiredHeight(rack) {
    var max = 1;
    rack.slots.forEach(function (slot) {
      var gear = gearById[slot.gearId];
      if (!gear) return;
      max = Math.max(max, slot.uPosition + gear.uHeight - 1);
    });
    return max;
  }

  function addSlot(rackId, uPosition, position, gearId) {
    var rack = state.racks.find(function (r) { return r.id === rackId; });
    if (!rack) return;
    rack.slots.push({ uPosition: uPosition, gearId: gearId, position: position });
  }

  function removeSlot(rackId, uPosition, position) {
    var rack = state.racks.find(function (r) { return r.id === rackId; });
    if (!rack) return;
    rack.slots = rack.slots.filter(function (s) {
      return !(s.uPosition === uPosition && s.position === position);
    });
  }

  // ================= Undo / change tracking =================
  // Single-level "toggle" undo: Ctrl/Cmd+Z (or the toolbar button) swaps the
  // current state with the one stored snapshot, so pressing it again re-applies
  // whatever it just undid. The button is disabled whenever no snapshot exists,
  // so every press does something predictable -- never a silent no-op.

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
    // For non-destructive edits (rename) that the spec's undo list excludes.
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
    } catch (err) {
      /* storage unavailable/full - non-critical for a planning tool */
    }
  }

  function normalizeImportedState(parsed) {
    var now = new Date().toISOString();
    var racks = Array.isArray(parsed.racks) ? parsed.racks.map(function (r) {
      var slots = Array.isArray(r.slots) ? r.slots.filter(function (s) {
        return s && typeof s.gearId === 'string' && Number.isInteger(s.uPosition) &&
          (s.position === 'full' || s.position === 'left' || s.position === 'right');
      }).map(function (s) {
        return { uPosition: s.uPosition, gearId: s.gearId, position: s.position };
      }) : [];
      return {
        id: typeof r.id === 'string' && r.id ? r.id : generateId('rack'),
        name: typeof r.name === 'string' && r.name.trim() ? r.name : 'Untitled rack',
        uHeight: Number.isInteger(r.uHeight) && r.uHeight > 0 ? r.uHeight : 4,
        x: Number.isFinite(r.x) ? r.x : 40,
        y: Number.isFinite(r.y) ? r.y : 40,
        slots: slots
      };
    }) : [];
    return {
      version: 1,
      name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Untitled Layout',
      created: typeof parsed.created === 'string' ? parsed.created : now,
      modified: now,
      racks: racks
    };
  }

  function defaultState() {
    var now = new Date().toISOString();
    return {
      version: 1,
      name: 'Untitled Layout',
      created: now,
      modified: now,
      racks: [
        { id: generateId('rack'), name: 'Rack 1', uHeight: 8, x: 40, y: 40, slots: [] }
      ]
    };
  }

  function loadInitialState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.racks)) return normalizeImportedState(parsed);
      }
    } catch (err) { /* ignore corrupt storage, fall back to default */ }
    return defaultState();
  }

  function hasUnsavedChanges() {
    if (lastSyncedSnapshot === null) return state.racks.length > 0;
    return JSON.stringify(state) !== lastSyncedSnapshot;
  }

  // ================= Gear catalog =================

  function loadGearCatalog() {
    return fetch('gear/gear.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        gearCatalog = Array.isArray(data) ? data : [];
      })
      .catch(function (err) {
        gearCatalog = [];
        gearLoadError = err.message + ' — if you opened this file directly from disk, try serving the site through a local web server instead.';
      })
      .then(function () {
        gearById = {};
        gearCatalog.forEach(function (g) { gearById[g.id] = g; });
      });
  }

  // ================= Rendering =================

  function render() {
    renderGearLibrary();
    renderCanvasRacks();
    fitCanvasToContent();
  }

  function renderGearLibrary() {
    if (gearLoadError) {
      gearListEl.innerHTML = '<p class="rb-gear-empty">' + escapeHtml(gearLoadError) + '</p>';
      return;
    }
    var q = filterState.search;
    var cat = filterState.category;
    var items = gearCatalog.filter(function (g) {
      return (cat === 'all' || g.category === cat) && (!q || g.name.toLowerCase().indexOf(q) !== -1);
    });
    gearListEl.innerHTML = '';
    if (!items.length) {
      gearListEl.innerHTML = '<p class="rb-gear-empty">No gear matches your search.</p>';
      return;
    }
    items.forEach(function (g) {
      gearListEl.appendChild(buildGearItemElement(g));
    });
  }

  function buildGearItemElement(gear) {
    var el = document.createElement('div');
    el.className = 'rb-gear-item';
    el.dataset.gearId = gear.id;
    var dot = CATEGORY_COLORS[gear.category] || '#8a8a8a';
    var label = CATEGORY_LABELS[gear.category] || gear.category;
    el.innerHTML =
      '<span class="rb-gear-dot" style="background:' + dot + '"></span>' +
      '<span class="rb-gear-info">' +
        '<span class="rb-gear-name">' + escapeHtml(gear.name) + '</span>' +
        '<span class="rb-gear-meta">' + gear.uHeight + 'U' + (gear.width === 'half' ? ' · half' : '') + ' · ' + escapeHtml(label) + '</span>' +
      '</span>';
    return el;
  }

  function renderCanvasRacks() {
    canvasEl.innerHTML = '';
    state.racks.forEach(function (rack) {
      canvasEl.appendChild(buildRackElement(rack));
    });
  }

  function fitCanvasToContent() {
    var maxX = 1200, maxY = 800;
    var frameW = RAIL_W * 2 + LABEL_W + FULL_W;
    state.racks.forEach(function (rack) {
      var frameH = 28 /* caps */ + rack.uHeight * U_PX + 34 /* titlebar */;
      maxX = Math.max(maxX, rack.x + frameW + 400);
      maxY = Math.max(maxY, rack.y + frameH + 400);
    });
    canvasEl.style.width = maxX + 'px';
    canvasEl.style.height = maxY + 'px';
  }

  function expandCanvasIfNeeded(x, y, w, h) {
    var margin = 400;
    var neededW = x + w + margin;
    var neededH = y + h + margin;
    var curW = parseInt(canvasEl.style.width, 10) || canvasEl.offsetWidth;
    var curH = parseInt(canvasEl.style.height, 10) || canvasEl.offsetHeight;
    if (neededW > curW) canvasEl.style.width = neededW + 'px';
    if (neededH > curH) canvasEl.style.height = neededH + 'px';
  }

  function buildRackElement(rack) {
    var el = document.createElement('div');
    el.className = 'rb-rack';
    el.dataset.rackId = rack.id;
    el.style.left = rack.x + 'px';
    el.style.top = rack.y + 'px';

    var titlebar = document.createElement('div');
    titlebar.className = 'rb-rack-titlebar';
    titlebar.innerHTML =
      '<input class="rb-rack-name" type="text" value="' + escapeHtml(rack.name) + '" aria-label="Rack name">' +
      '<span class="rb-rack-uheight">' + rack.uHeight + 'U</span>' +
      '<button type="button" class="rb-rack-delete" title="Delete rack" aria-label="Delete rack">🗑</button>';
    el.appendChild(titlebar);

    var frame = document.createElement('div');
    frame.className = 'rb-rack-frame';

    var inner = document.createElement('div');
    inner.className = 'rb-rack-frame-inner';
    renderRackFrameInner(rack, inner);
    frame.appendChild(inner);

    var handle = document.createElement('div');
    handle.className = 'rb-resize-handle';
    handle.title = 'Drag to resize (bottom only)';
    frame.appendChild(handle);

    el.appendChild(frame);
    return el;
  }

  function renderRackFrameInner(rack, container) {
    container.innerHTML = '';

    var capTop = document.createElement('div');
    capTop.className = 'rb-rack-cap rb-cap-top';
    container.appendChild(capTop);

    var bodyRow = document.createElement('div');
    bodyRow.className = 'rb-rack-body-row';

    var railLeft = document.createElement('div');
    railLeft.className = 'rb-rail';
    bodyRow.appendChild(railLeft);

    var body = document.createElement('div');
    body.className = 'rb-rack-body';
    body.style.position = 'relative';

    var occ = computeOccupancy(rack);

    for (var u = 1; u <= rack.uHeight; u++) {
      var row = document.createElement('div');
      row.className = 'rb-u-row';

      var labelEl = document.createElement('div');
      labelEl.className = 'rb-u-label';
      labelEl.textContent = String(u);
      row.appendChild(labelEl);

      var slotRow = document.createElement('div');
      slotRow.className = 'rb-slot-row';
      buildSlotRowCells(rack, u, occ[u], slotRow);
      row.appendChild(slotRow);

      body.appendChild(row);
    }

    rack.slots.forEach(function (slot) {
      var gear = gearById[slot.gearId];
      if (!gear) return;
      body.appendChild(buildGearOverlay(rack, slot, gear));
    });

    bodyRow.appendChild(body);

    var railRight = document.createElement('div');
    railRight.className = 'rb-rail';
    bodyRow.appendChild(railRight);

    container.appendChild(bodyRow);

    var capBottom = document.createElement('div');
    capBottom.className = 'rb-rack-cap rb-cap-bottom';
    container.appendChild(capBottom);
  }

  function buildSlotRowCells(rack, u, cell, slotRowEl) {
    if (cell.full) {
      slotRowEl.appendChild(makeSlotEl(rack.id, u, 'full', true));
      return;
    }
    if (!cell.left && !cell.right) {
      slotRowEl.appendChild(makeSlotEl(rack.id, u, 'full', false));
      return;
    }
    slotRowEl.appendChild(makeSlotEl(rack.id, u, 'left', !!cell.left));
    slotRowEl.appendChild(makeSlotEl(rack.id, u, 'right', !!cell.right));
  }

  function makeSlotEl(rackId, uPosition, half, occupied) {
    var el = document.createElement('div');
    el.className = 'rb-slot ' + (half === 'full' ? 'rb-slot-full' : 'rb-slot-half rb-slot-half-' + half);
    el.classList.add(occupied ? 'rb-slot-occupied' : 'rb-slot-empty');
    el.dataset.rackId = rackId;
    el.dataset.uPosition = String(uPosition);
    el.dataset.half = half;
    if (half === 'full' && !occupied) {
      var hint = document.createElement('div');
      hint.className = 'rb-slot-half-hint';
      el.appendChild(hint);
    }
    return el;
  }

  function buildGearOverlay(rack, slot, gear) {
    var el = document.createElement('div');
    el.className = 'rb-gear-placed';
    el.dataset.rackId = rack.id;
    el.dataset.uPosition = String(slot.uPosition);
    el.dataset.position = slot.position;
    el.dataset.gearId = slot.gearId;
    var top = (slot.uPosition - 1) * U_PX;
    var height = gear.uHeight * U_PX;
    var width = gear.width === 'half' ? HALF_W : FULL_W;
    var left = LABEL_W + (slot.position === 'right' ? HALF_W : 0);
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    el.style.width = width + 'px';
    el.style.height = height + 'px';
    el.title = gear.name;

    var img = document.createElement('img');
    img.src = gear.image;
    img.alt = gear.name;
    img.draggable = false;
    el.appendChild(img);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'rb-gear-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove ' + gear.name;
    removeBtn.setAttribute('aria-label', 'Remove ' + gear.name);
    el.appendChild(removeBtn);

    return el;
  }

  // ================= Drag ghost =================

  function createGhost(gear, x, y) {
    var w = gear.width === 'half' ? HALF_W : FULL_W;
    var h = gear.uHeight * U_PX;
    var ghost = document.createElement('div');
    ghost.className = 'rb-drag-ghost';
    ghost.style.width = w + 'px';
    ghost.style.height = h + 'px';
    var img = document.createElement('img');
    img.src = gear.image;
    img.alt = '';
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    dragCtx.ghostEl = ghost;
    dragCtx.ghostW = w;
    dragCtx.ghostH = h;
    positionGhost(ghost, x, y, w, h);
  }

  function positionGhost(ghost, x, y, w, h) {
    ghost.style.left = (x - w / 2) + 'px';
    ghost.style.top = (y - h / 2) + 'px';
  }

  function gearForDrag() {
    return gearById[dragCtx.gearId];
  }

  function isPointOverSidebar(x, y) {
    var rect = sidebarEl.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function clearHoverHighlights() {
    if (dragCtx && dragCtx.hoverSlotEl) {
      dragCtx.hoverSlotEl.classList.remove('rb-drop-valid', 'rb-drop-invalid', 'rb-hint-left', 'rb-hint-right', 'rb-hint-invalid');
      dragCtx.hoverSlotEl = null;
    }
  }

  function applyHoverHighlight(slotEl, targetPosition, valid) {
    slotEl.classList.remove('rb-drop-valid', 'rb-drop-invalid', 'rb-hint-left', 'rb-hint-right', 'rb-hint-invalid');
    var half = slotEl.dataset.half;
    if (half === 'full' && targetPosition !== 'full') {
      slotEl.classList.add(targetPosition === 'left' ? 'rb-hint-left' : 'rb-hint-right');
      if (!valid) slotEl.classList.add('rb-hint-invalid');
    } else {
      slotEl.classList.add(valid ? 'rb-drop-valid' : 'rb-drop-invalid');
    }
    dragCtx.hoverSlotEl = slotEl;
  }

  function updateSlotHover(x, y, gear) {
    clearHoverHighlights();
    var el = document.elementFromPoint(x, y);
    var slotEl = el && el.closest ? el.closest('.rb-slot') : null;
    if (!slotEl) {
      dragCtx.hoverSlot = null;
      return;
    }
    var rackId = slotEl.dataset.rackId;
    var uPosition = parseInt(slotEl.dataset.uPosition, 10);
    var half = slotEl.dataset.half;
    var rect = slotEl.getBoundingClientRect();

    var targetPosition;
    if (gear.width === 'full') {
      targetPosition = 'full';
    } else if (half === 'left' || half === 'right') {
      targetPosition = half;
    } else if (slotEl.classList.contains('rb-slot-occupied')) {
      // Row is filled by a full-width device; there's no left/right to target.
      targetPosition = 'full';
    } else {
      targetPosition = (x < rect.left + rect.width / 2) ? 'left' : 'right';
    }

    var valid = canPlace(rackId, uPosition, targetPosition, gear, dragCtx.excludeSlot);
    dragCtx.hoverSlot = { rackId: rackId, uPosition: uPosition, targetPosition: targetPosition, valid: valid };
    applyHoverHighlight(slotEl, targetPosition, valid);
  }

  // ================= Drag: gear from library =================

  function startLibraryGearDrag(e, itemEl) {
    var gear = gearById[itemEl.dataset.gearId];
    if (!gear) return;
    dragCtx = {
      type: 'library',
      gearId: gear.id,
      pointerId: e.pointerId,
      sourceItemEl: itemEl,
      startX: e.clientX,
      startY: e.clientY,
      started: false
    };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  // ================= Drag: placed gear (move / remove) =================

  function startPlacedGearDrag(e, placedEl) {
    var rackEl = placedEl.closest('.rb-rack');
    var rackId = rackEl.dataset.rackId;
    var uPosition = parseInt(placedEl.dataset.uPosition, 10);
    var position = placedEl.dataset.position;
    var gear = gearById[placedEl.dataset.gearId];
    if (!gear) return;
    dragCtx = {
      type: 'placed',
      gearId: gear.id,
      sourceRackId: rackId,
      sourceUPosition: uPosition,
      sourcePosition: position,
      excludeSlot: { rackId: rackId, uPosition: uPosition, position: position },
      pointerId: e.pointerId,
      sourcePlacedEl: placedEl,
      startX: e.clientX,
      startY: e.clientY,
      started: false
    };
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  function finishGearDrag(e) {
    if (!dragCtx.started) return;
    var hover = dragCtx.hoverSlot;
    clearHoverHighlights();
    if (dragCtx.ghostEl) dragCtx.ghostEl.remove();
    if (dragCtx.sourceItemEl) dragCtx.sourceItemEl.classList.remove('rb-dragging-source');
    if (dragCtx.sourcePlacedEl) dragCtx.sourcePlacedEl.classList.remove('rb-dragging-placed');

    if (dragCtx.type === 'placed' && isPointOverSidebar(e.clientX, e.clientY)) {
      beginChange();
      removeSlot(dragCtx.sourceRackId, dragCtx.sourceUPosition, dragCtx.sourcePosition);
      commitChange();
      return;
    }

    if (!hover || !hover.valid) return;

    beginChange();
    if (dragCtx.type === 'placed') {
      removeSlot(dragCtx.sourceRackId, dragCtx.sourceUPosition, dragCtx.sourcePosition);
    }
    addSlot(hover.rackId, hover.uPosition, hover.targetPosition, dragCtx.gearId);
    commitChange();
  }

  // ================= Drag: rack reposition =================

  function startRackDrag(e, titlebarEl) {
    var rackEl = titlebarEl.closest('.rb-rack');
    var rackId = rackEl.dataset.rackId;
    var rack = state.racks.find(function (r) { return r.id === rackId; });
    if (!rack) return;
    var canvasRect = canvasEl.getBoundingClientRect();
    dragCtx = {
      type: 'rack',
      rackId: rackId,
      rackEl: rackEl,
      pointerId: e.pointerId,
      offsetX: e.clientX - (canvasRect.left + rack.x),
      offsetY: e.clientY - (canvasRect.top + rack.y),
      moved: false
    };
    rackEl.classList.add('rb-dragging');
    beginChange();
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  function moveRackDrag(e) {
    var canvasRect = canvasEl.getBoundingClientRect();
    var x = snapToGrid(e.clientX - canvasRect.left - dragCtx.offsetX);
    var y = snapToGrid(e.clientY - canvasRect.top - dragCtx.offsetY);
    x = Math.max(0, x);
    y = Math.max(0, y);
    dragCtx.moved = true;
    dragCtx.newX = x;
    dragCtx.newY = y;
    dragCtx.rackEl.style.left = x + 'px';
    dragCtx.rackEl.style.top = y + 'px';
    expandCanvasIfNeeded(x, y, dragCtx.rackEl.offsetWidth, dragCtx.rackEl.offsetHeight);
  }

  function finishRackDrag() {
    dragCtx.rackEl.classList.remove('rb-dragging');
    var rack = state.racks.find(function (r) { return r.id === dragCtx.rackId; });
    if (dragCtx.moved && rack) {
      rack.x = dragCtx.newX;
      rack.y = dragCtx.newY;
      commitChange();
    } else {
      pendingSnapshot = null;
    }
  }

  // ================= Drag: resize (bottom edge only) =================

  function startResizeDrag(e, handleEl) {
    var rackEl = handleEl.closest('.rb-rack');
    var rackId = rackEl.dataset.rackId;
    var rack = state.racks.find(function (r) { return r.id === rackId; });
    if (!rack) return;
    handleEl.classList.add('rb-resizing');
    dragCtx = {
      type: 'resize',
      rackId: rackId,
      handleEl: handleEl,
      frameInnerEl: rackEl.querySelector('.rb-rack-frame-inner'),
      startY: e.clientY,
      startUHeight: rack.uHeight,
      pendingUHeight: rack.uHeight
    };
    beginChange();
    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
    document.addEventListener('pointercancel', onDragEnd);
  }

  function moveResizeDrag(e) {
    var rack = state.racks.find(function (r) { return r.id === dragCtx.rackId; });
    if (!rack) return;
    var deltaU = Math.round((e.clientY - dragCtx.startY) / U_PX);
    var minHeight = lowestRequiredHeight(rack);
    var newHeight = Math.max(minHeight, dragCtx.startUHeight + deltaU, 1);
    if (newHeight !== dragCtx.pendingUHeight) {
      dragCtx.pendingUHeight = newHeight;
      rack.uHeight = newHeight;
      renderRackFrameInner(rack, dragCtx.frameInnerEl);
      var rackEl = dragCtx.handleEl.closest('.rb-rack');
      var uheightLabel = rackEl.querySelector('.rb-rack-uheight');
      if (uheightLabel) uheightLabel.textContent = rack.uHeight + 'U';
      expandCanvasIfNeeded(rack.x, rack.y, rackEl.offsetWidth, rackEl.offsetHeight);
    }
  }

  function finishResizeDrag() {
    dragCtx.handleEl.classList.remove('rb-resizing');
    var rack = state.racks.find(function (r) { return r.id === dragCtx.rackId; });
    if (rack && rack.uHeight !== dragCtx.startUHeight) {
      commitChange();
    } else {
      pendingSnapshot = null;
    }
  }

  // ================= Drag dispatch =================

  function onDragMove(e) {
    if (!dragCtx) return;
    if (dragCtx.type === 'library' || dragCtx.type === 'placed') {
      if (!dragCtx.started) {
        var dx = e.clientX - dragCtx.startX, dy = e.clientY - dragCtx.startY;
        if (Math.hypot(dx, dy) < 4) return;
        dragCtx.started = true;
        if (dragCtx.sourceItemEl) dragCtx.sourceItemEl.classList.add('rb-dragging-source');
        if (dragCtx.sourcePlacedEl) dragCtx.sourcePlacedEl.classList.add('rb-dragging-placed');
        createGhost(gearForDrag(), e.clientX, e.clientY);
      }
      positionGhost(dragCtx.ghostEl, e.clientX, e.clientY, dragCtx.ghostW, dragCtx.ghostH);
      updateSlotHover(e.clientX, e.clientY, gearForDrag());
    } else if (dragCtx.type === 'rack') {
      moveRackDrag(e);
    } else if (dragCtx.type === 'resize') {
      moveResizeDrag(e);
    }
  }

  function onDragEnd(e) {
    if (!dragCtx) return;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);

    var type = dragCtx.type;
    if (type === 'library' || type === 'placed') finishGearDrag(e);
    else if (type === 'rack') finishRackDrag();
    else if (type === 'resize') finishResizeDrag();

    dragCtx = null;
  }

  function cancelActiveDrag() {
    if (!dragCtx) return;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);

    clearHoverHighlights();
    if (dragCtx.ghostEl) dragCtx.ghostEl.remove();
    if (dragCtx.sourceItemEl) dragCtx.sourceItemEl.classList.remove('rb-dragging-source');
    if (dragCtx.sourcePlacedEl) dragCtx.sourcePlacedEl.classList.remove('rb-dragging-placed');
    if (dragCtx.rackEl) dragCtx.rackEl.classList.remove('rb-dragging');
    if (dragCtx.handleEl) dragCtx.handleEl.classList.remove('rb-resizing');

    if (dragCtx.type === 'resize') {
      var rack = state.racks.find(function (r) { return r.id === dragCtx.rackId; });
      if (rack) rack.uHeight = dragCtx.startUHeight;
    }
    pendingSnapshot = null;
    render();
    dragCtx = null;
  }

  // ================= Toolbar / misc controls =================

  function findOpenSpot() {
    var n = state.racks.length;
    return { x: snapToGrid(40 + (n % 8) * 40), y: snapToGrid(40 + (n % 8) * 30) };
  }

  function addRack() {
    beginChange();
    var spot = findOpenSpot();
    var rack = { id: generateId('rack'), name: 'New rack', uHeight: 4, x: spot.x, y: spot.y, slots: [] };
    state.racks.push(rack);
    commitChange();
    requestAnimationFrame(function () {
      var input = canvasEl.querySelector('.rb-rack[data-rack-id="' + rack.id + '"] .rb-rack-name');
      if (input) { input.focus(); input.select(); }
    });
  }

  function deleteRack(rack) {
    var count = rack.slots.length;
    var msg = count > 0
      ? 'Delete "' + rack.name + '"? This rack has ' + count + ' device' + (count === 1 ? '' : 's') + ' placed. This can be undone with Ctrl/Cmd+Z immediately after.'
      : 'Delete "' + rack.name + '"?';
    if (!window.confirm(msg)) return;
    beginChange();
    state.racks = state.racks.filter(function (r) { return r.id !== rack.id; });
    commitChange();
  }

  function doExport() {
    var dataStr = JSON.stringify(state, null, 2);
    var blob = new Blob([dataStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var dateStr = new Date().toISOString().slice(0, 10);
    var safeName = (state.name || 'layout').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.href = url;
    a.download = (safeName || 'rack-layout') + '-' + dateStr + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    lastSyncedSnapshot = JSON.stringify(state);
  }

  function doImportClick() {
    if (hasUnsavedChanges()) {
      var ok = window.confirm('Your current layout hasn\'t been exported. Importing a file will replace the entire workspace. Continue?');
      if (!ok) return;
    }
    importInput.click();
  }

  function doImportFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.racks)) throw new Error('This file doesn\'t look like a Rack Builder layout.');
        state = normalizeImportedState(parsed);
        undoSnapshot = null;
        lastSyncedSnapshot = JSON.stringify(state);
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
    sidebarEl = document.querySelector('.rb-sidebar');
    gearListEl = document.getElementById('rb-gear-list');
    searchInput = document.getElementById('rb-search');
    filterPillsEl = document.getElementById('rb-filter-pills');
    canvasViewportEl = document.getElementById('rb-canvas-viewport');
    canvasEl = document.getElementById('rb-canvas');
    addRackBtn = document.getElementById('rb-add-rack');
    undoBtn = document.getElementById('rb-undo');
    exportBtn = document.getElementById('rb-export');
    importBtn = document.getElementById('rb-import-btn');
    importInput = document.getElementById('rb-import-input');
  }

  function wireEvents() {
    document.addEventListener('pointerdown', function (e) {
      if (dragCtx) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;

      var resizeHandle = e.target.closest('.rb-resize-handle');
      if (resizeHandle) { startResizeDrag(e, resizeHandle); return; }

      var gearItem = e.target.closest('.rb-gear-item');
      if (gearItem) { startLibraryGearDrag(e, gearItem); return; }

      var placedGear = e.target.closest('.rb-gear-placed');
      if (placedGear && !e.target.closest('.rb-gear-remove')) { startPlacedGearDrag(e, placedGear); return; }

      var titlebar = e.target.closest('.rb-rack-titlebar');
      if (titlebar && !e.target.closest('.rb-rack-name') && !e.target.closest('.rb-rack-delete')) {
        startRackDrag(e, titlebar);
      }
    });

    document.addEventListener('click', function (e) {
      var delBtn = e.target.closest('.rb-rack-delete');
      if (delBtn) {
        var rackEl = delBtn.closest('.rb-rack');
        var rack = state.racks.find(function (r) { return r.id === rackEl.dataset.rackId; });
        if (rack) deleteRack(rack);
        return;
      }
      var removeBtn = e.target.closest('.rb-gear-remove');
      if (removeBtn) {
        var placedEl = removeBtn.closest('.rb-gear-placed');
        beginChange();
        removeSlot(placedEl.dataset.rackId, parseInt(placedEl.dataset.uPosition, 10), placedEl.dataset.position);
        commitChange();
        return;
      }
    });

    document.addEventListener('focusout', function (e) {
      var input = e.target.closest ? e.target.closest('.rb-rack-name') : null;
      if (!input) return;
      var rackEl = input.closest('.rb-rack');
      var rack = state.racks.find(function (r) { return r.id === rackEl.dataset.rackId; });
      if (!rack) return;
      var newName = input.value.trim() || 'Untitled rack';
      if (newName !== rack.name) {
        rack.name = newName;
        applyMinorChange();
      } else {
        input.value = rack.name;
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && dragCtx) { cancelActiveDrag(); return; }
      if (e.target.matches('.rb-rack-name') && e.key === 'Enter') { e.target.blur(); return; }
      if (e.target.matches('input, textarea, select')) return;
      var isUndo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
      if (isUndo) { e.preventDefault(); performUndo(); }
    });

    searchInput.addEventListener('input', function () {
      filterState.search = searchInput.value.trim().toLowerCase();
      renderGearLibrary();
    });

    filterPillsEl.addEventListener('click', function (e) {
      var pill = e.target.closest('.rb-pill');
      if (!pill) return;
      Array.prototype.forEach.call(filterPillsEl.querySelectorAll('.rb-pill'), function (p) {
        p.classList.remove('active');
      });
      pill.classList.add('active');
      filterState.category = pill.dataset.category;
      renderGearLibrary();
    });

    addRackBtn.addEventListener('click', addRack);
    undoBtn.addEventListener('click', performUndo);
    exportBtn.addEventListener('click', doExport);
    importBtn.addEventListener('click', doImportClick);
    importInput.addEventListener('change', function () {
      var file = importInput.files[0];
      if (file) doImportFile(file);
    });
  }

  // ================= Init =================

  function init() {
    cacheDom();
    loadGearCatalog().then(function () {
      state = loadInitialState();
      lastSyncedSnapshot = null;
      wireEvents();
      render();
      updateUndoButton();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
