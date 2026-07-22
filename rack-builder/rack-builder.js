(function () {
  'use strict';

  // ---------- Render-scale constants ----------
  // U_PX matches true 19in-rail proportions (19/1.75 ~= 10.86:1 width:height per U)
  // against the bled full-width frame (RAIL_W*2 + FULL_W = 436px), so real gear
  // photos need minimal stretching: 436 / 10.86 ~= 40.
  var U_PX = 40;
  var FULL_W = 380;
  var HALF_W = 190;
  var RAIL_W = 28;
  var LABEL_W = 18;
  var GRID = 20;
  var STORAGE_KEY = 'rackBuilderLayout.v1';
  var SIDEBAR_WIDTH_KEY = 'rackBuilderSidebarWidth.v1';
  var SIDEBAR_MIN_W = 200;
  var SIDEBAR_MAX_W = 560;

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
  var addRackBtn, undoBtn, exportBtn, importBtn, importInput, patchListBtn;

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
  var topZCounter = 0;

  // ---------- Patch tooltip / patch list state ----------
  var tooltipEl = null;
  var tooltipState = null; // { rackId, uPosition, position, gearId, mode: 'view'|'edit', anchorEl }
  var tooltipHideTimer = null;
  var tooltipShowTimer = null; // debounces which device "wins" the shared tooltip -- see onPlacedGearHoverEnter
  var pendingShowKey = null;
  var tooltipEditSnapshot = null; // pre-edit deep clone of state, used only by the tooltip editor
  var patchListOverlayEl = null;

  // ================= Utilities =================

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function gearImageUrl(gear) {
    // gear.json's "image" field is relative to the gear/ folder (per the
    // spec's directory layout), not to index.html, so it needs the prefix.
    return 'gear/' + gear.image;
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

  function addSlot(rackId, uPosition, position, gearId, label, connections) {
    var rack = state.racks.find(function (r) { return r.id === rackId; });
    if (!rack) return;
    var slot = { uPosition: uPosition, gearId: gearId, position: position };
    if (label) slot.label = label;
    if (connections && connections.length) slot.connections = deepClone(connections);
    rack.slots.push(slot);
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
        var out = { uPosition: s.uPosition, gearId: s.gearId, position: s.position };
        if (typeof s.label === 'string' && s.label.trim()) out.label = s.label.trim();
        if (Array.isArray(s.connections)) {
          var conns = s.connections.filter(function (c) {
            return c && (c.direction === 'in' || c.direction === 'out') &&
              (typeof c.description === 'string') && (typeof c.patchedTo === 'string');
          }).map(function (c) {
            return {
              id: typeof c.id === 'string' && c.id ? c.id : generateId('conn'),
              direction: c.direction,
              description: c.description.trim(),
              patchedTo: c.patchedTo.trim()
            };
          });
          if (conns.length) out.connections = conns;
        }
        return out;
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
        gearCatalog.sort(function (a, b) { return a.name.localeCompare(b.name); });
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
      '<span class="rb-gear-thumb"><img src="' + escapeHtml(gearImageUrl(gear)) + '" alt="" loading="lazy"></span>' +
      '<span class="rb-gear-dot" style="background:' + dot + '"></span>' +
      '<span class="rb-gear-info">' +
        '<span class="rb-gear-name">' + escapeHtml(gear.name) + '</span>' +
        '<span class="rb-gear-meta">' + gear.uHeight + 'U' + (gear.width === 'half' ? ' · half' : '') + ' · ' + escapeHtml(label) + '</span>' +
      '</span>';
    return el;
  }

  function renderCanvasRacks() {
    canvasEl.innerHTML = '';
    state.racks.forEach(function (rack, index) {
      canvasEl.appendChild(buildRackElement(rack, index));
    });
    topZCounter = state.racks.length;
  }

  function bringRackToFront(rackId, rackEl) {
    var idx = state.racks.findIndex(function (r) { return r.id === rackId; });
    if (idx === -1) return;
    var rack = state.racks.splice(idx, 1)[0];
    state.racks.push(rack);
    topZCounter += 1;
    rackEl.style.zIndex = String(topZCounter);
    applyMinorChange();
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

  function buildRackElement(rack, index) {
    var el = document.createElement('div');
    el.className = 'rb-rack';
    el.dataset.rackId = rack.id;
    el.style.left = rack.x + 'px';
    el.style.top = rack.y + 'px';
    el.style.zIndex = String(index + 1);

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

    var labelCol = document.createElement('div');
    labelCol.className = 'rb-u-label-col';
    bodyRow.appendChild(labelCol);

    var railLeft = document.createElement('div');
    railLeft.className = 'rb-rail';
    bodyRow.appendChild(railLeft);

    var body = document.createElement('div');
    body.className = 'rb-rack-body';

    var occ = computeOccupancy(rack);

    for (var u = 1; u <= rack.uHeight; u++) {
      var labelEl = document.createElement('div');
      labelEl.className = 'rb-u-label';
      labelEl.textContent = String(u);
      labelCol.appendChild(labelEl);

      var row = document.createElement('div');
      row.className = 'rb-u-row';

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
    var width, left;
    if (slot.position === 'full') {
      // Bleed the image out over both rails so a device's own mounting-ear
      // artwork lands on the rail instead of floating beside it. The U-number
      // label lives outside the rail now (see renderRackFrameInner), so this
      // bleed never has to worry about covering it.
      left = -RAIL_W;
      width = RAIL_W + FULL_W + RAIL_W;
    } else {
      width = HALF_W;
      left = (slot.position === 'right' ? HALF_W : 0);
    }
    el.style.top = top + 'px';
    el.style.left = left + 'px';
    el.style.width = width + 'px';
    el.style.height = height + 'px';

    var img = document.createElement('img');
    img.src = gearImageUrl(gear);
    img.alt = gear.name;
    img.draggable = false;
    el.appendChild(img);

    if (gear.customLabel) {
      var labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'rb-gear-custom-label';
      labelInput.placeholder = 'Click to label';
      labelInput.value = slot.label || '';
      labelInput.setAttribute('aria-label', 'Custom label for ' + gear.name);
      el.appendChild(labelInput);
    }

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'rb-gear-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove ' + gear.name;
    removeBtn.setAttribute('aria-label', 'Remove ' + gear.name);
    el.appendChild(removeBtn);

    el.addEventListener('mouseenter', function () {
      onPlacedGearHoverEnter(el, rack.id, slot.uPosition, slot.position, slot.gearId);
    });
    el.addEventListener('mouseleave', function () {
      onPlacedGearHoverLeave(rack.id, slot.uPosition, slot.position);
    });

    return el;
  }

  function findSlot(rackId, uPosition, position) {
    var rack = state.racks.find(function (r) { return r.id === rackId; });
    if (!rack) return null;
    return rack.slots.find(function (s) { return s.uPosition === uPosition && s.position === position; }) || null;
  }

  // ================= Patch tooltip =================
  // Hover any placed device to see its patch connections (freeform, per-placement
  // text entered by the user -- see slot.connections). Click anywhere in the
  // tooltip to edit; the edit session reuses the app's existing snapshot/diff
  // undo pattern (see finishResizeDrag) via a dedicated snapshot variable so it
  // never collides with the drag system's shared pendingSnapshot.

  function tooltipSlotKey(rackId, uPosition, position) {
    return rackId + '|' + uPosition + '|' + position;
  }

  function cancelPendingTooltipShow() {
    if (tooltipShowTimer) { clearTimeout(tooltipShowTimer); tooltipShowTimer = null; }
    pendingShowKey = null;
  }

  function ensureTooltipEl() {
    if (tooltipEl) return;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'rb-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
    tooltipEl.addEventListener('mouseenter', function () {
      if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
      // Reaching the tooltip itself always wins: abandon any pending switch
      // to a neighboring device the cursor may have grazed on the way here
      // (see onPlacedGearHoverEnter -- devices in a tightly packed rack can
      // sit right behind this tooltip since it's narrower than a full-width
      // device's rendered bleed width).
      cancelPendingTooltipShow();
    });
    tooltipEl.addEventListener('mouseleave', function () {
      if (!tooltipState || tooltipState.mode === 'edit') return;
      tooltipHideTimer = setTimeout(function () { hideTooltip(); tooltipState = null; }, 150);
    });
  }

  function showTooltip() {
    ensureTooltipEl();
    tooltipEl.style.display = 'block';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function closeTooltipIfAny() {
    cancelPendingTooltipShow();
    if (!tooltipState) return;
    if (tooltipState.mode === 'edit') {
      finishTooltipEdit(false);
    } else {
      if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
      hideTooltip();
      tooltipState = null;
    }
  }

  function positionTooltip(anchorEl) {
    ensureTooltipEl();
    var rect = anchorEl.getBoundingClientRect();
    tooltipEl.style.visibility = 'hidden';
    tooltipEl.style.display = 'block';
    var tw = tooltipEl.offsetWidth;
    var th = tooltipEl.offsetHeight;
    // Keep clear of the sticky site nav + app toolbar rather than clamping
    // to the bare top of the viewport, so the tooltip never renders under
    // (or visually fights with) those controls when the anchor device is
    // near the top of the canvas.
    var toolbarEl = document.querySelector('.rb-toolbar');
    var minY = (toolbarEl ? toolbarEl.getBoundingClientRect().bottom : 0) + 8;
    var x = rect.left + rect.width / 2 - tw / 2;
    var y = rect.top - th - 10;
    if (y < minY) y = rect.bottom + 10; // not enough room above -- show below instead
    x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
    y = Math.max(minY, Math.min(y, window.innerHeight - th - 8));
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
    tooltipEl.style.visibility = 'visible';
  }

  function renderTooltipView() {
    ensureTooltipEl();
    var gear = gearById[tooltipState.gearId];
    var slot = findSlot(tooltipState.rackId, tooltipState.uPosition, tooltipState.position);
    var conns = (slot && slot.connections) || [];
    var name = gear ? gear.name : 'Unknown device';

    var html = '<div class="rb-tooltip-header">' + escapeHtml(name) + '</div>';
    if (!conns.length) {
      html += '<p class="rb-tooltip-empty">No patch info yet — click to add.</p>';
    } else {
      html += '<div class="rb-tooltip-list">';
      conns.forEach(function (c) {
        var arrow = c.direction === 'out' ? '→' : '←';
        html +=
          '<div class="rb-tooltip-row">' +
            '<span class="rb-tooltip-arrow">' + arrow + '</span>' +
            '<span class="rb-tooltip-desc">' + escapeHtml(c.description || '(no description)') + '</span>' +
          '</div>' +
          '<div class="rb-tooltip-patchto">' + escapeHtml(c.patchedTo || '(not specified)') + '</div>';
      });
      html += '</div>';
    }
    tooltipEl.classList.remove('rb-tooltip-editing');
    tooltipEl.innerHTML = html;
    tooltipEl.onclick = function () { enterTooltipEditMode(); };
  }

  function onPlacedGearHoverEnter(el, rackId, uPosition, position, gearId) {
    if (dragCtx) return;

    // Never let an incidental graze interrupt an active edit session --
    // only explicit actions (click outside, Escape, the close button) end
    // one. This also covers the same stacked-devices case as below: editing
    // a device whose tooltip overlaps a neighbor shouldn't be knocked out
    // of edit mode just because the cursor crossed that neighbor en route
    // to a field inside the tooltip.
    if (tooltipState && tooltipState.mode === 'edit') return;

    var key = tooltipSlotKey(rackId, uPosition, position);
    if (tooltipState && tooltipState.rackId === rackId && tooltipState.uPosition === uPosition && tooltipState.position === position) {
      // Already showing this exact device; nothing to do.
      cancelPendingTooltipShow();
      return;
    }

    // Debounce which device "wins" the shared tooltip. In a tightly packed
    // rack, this tooltip (capped at 320px) can sit over only the center of
    // a full-width neighbor (rendered up to 436px wide with rail bleed), so
    // moving the mouse toward the tooltip often clips a sliver of that
    // neighbor first. Require a brief dwell before actually switching, so a
    // transient graze doesn't steal the tooltip out from under the device
    // the user actually meant to read/edit.
    if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
    cancelPendingTooltipShow();
    pendingShowKey = key;
    tooltipShowTimer = setTimeout(function () {
      tooltipShowTimer = null;
      pendingShowKey = null;
      tooltipState = { rackId: rackId, uPosition: uPosition, position: position, gearId: gearId, mode: 'view', anchorEl: el };
      renderTooltipView();
      positionTooltip(el);
      showTooltip();
    }, 90);
  }

  function onPlacedGearHoverLeave(rackId, uPosition, position) {
    var key = tooltipSlotKey(rackId, uPosition, position);
    if (pendingShowKey === key) cancelPendingTooltipShow();

    if (!tooltipState || tooltipState.mode === 'edit') return;
    if (tooltipState.rackId !== rackId || tooltipState.uPosition !== uPosition || tooltipState.position !== position) return;
    tooltipHideTimer = setTimeout(function () {
      hideTooltip();
      tooltipState = null;
    }, 150);
  }

  function enterTooltipEditMode() {
    if (!tooltipState || tooltipState.mode === 'edit') return;
    tooltipState.mode = 'edit';
    if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
    cancelPendingTooltipShow();
    tooltipEditSnapshot = deepClone(state);
    renderTooltipEdit();
    positionTooltip(tooltipState.anchorEl);
  }

  function buildConnectionRow(slot, conn) {
    var row = document.createElement('div');
    row.className = 'rb-tooltip-edit-row';

    var dirBtn = document.createElement('button');
    dirBtn.type = 'button';
    dirBtn.className = 'rb-conn-dir-toggle';
    dirBtn.textContent = conn.direction === 'out' ? '→ Out' : '← In';
    dirBtn.addEventListener('click', function () {
      conn.direction = conn.direction === 'out' ? 'in' : 'out';
      dirBtn.textContent = conn.direction === 'out' ? '→ Out' : '← In';
    });
    row.appendChild(dirBtn);

    var descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'rb-conn-desc';
    descInput.placeholder = 'e.g. Mic In (XLR L/R)';
    descInput.value = conn.description || '';
    descInput.addEventListener('input', function () { conn.description = descInput.value; });
    row.appendChild(descInput);

    var toInput = document.createElement('input');
    toInput.type = 'text';
    toInput.className = 'rb-conn-to';
    toInput.placeholder = 'Patched to, e.g. XLR Patchbay, jacks 9–10';
    toInput.value = conn.patchedTo || '';
    toInput.addEventListener('input', function () { conn.patchedTo = toInput.value; });
    row.appendChild(toInput);

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'rb-conn-remove';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove connection');
    removeBtn.addEventListener('click', function () {
      var i = slot.connections.indexOf(conn);
      if (i !== -1) slot.connections.splice(i, 1);
      renderTooltipEdit();
      positionTooltip(tooltipState.anchorEl);
    });
    row.appendChild(removeBtn);

    return row;
  }

  function renderTooltipEdit() {
    ensureTooltipEl();
    var slot = findSlot(tooltipState.rackId, tooltipState.uPosition, tooltipState.position);
    if (!slot) { finishTooltipEdit(false); return; }
    if (!slot.connections) slot.connections = [];
    var gear = gearById[tooltipState.gearId];
    var name = gear ? gear.name : 'Unknown device';

    tooltipEl.classList.add('rb-tooltip-editing');
    tooltipEl.innerHTML = '';
    tooltipEl.onclick = null;

    var header = document.createElement('div');
    header.className = 'rb-tooltip-edit-header';
    var headerName = document.createElement('span');
    headerName.textContent = name;
    header.appendChild(headerName);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'rb-tooltip-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close patch editor');
    closeBtn.addEventListener('click', function () { finishTooltipEdit(false); });
    header.appendChild(closeBtn);
    tooltipEl.appendChild(header);

    var rowsWrap = document.createElement('div');
    rowsWrap.className = 'rb-tooltip-edit-rows';
    slot.connections.forEach(function (conn) {
      rowsWrap.appendChild(buildConnectionRow(slot, conn));
    });
    tooltipEl.appendChild(rowsWrap);

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'rb-tooltip-add-row';
    addBtn.textContent = '+ Add connection';
    addBtn.addEventListener('click', function () {
      slot.connections.push({ id: generateId('conn'), direction: 'in', description: '', patchedTo: '' });
      renderTooltipEdit();
      positionTooltip(tooltipState.anchorEl);
    });
    tooltipEl.appendChild(addBtn);
  }

  function finishTooltipEdit(revert) {
    if (revert) {
      state = tooltipEditSnapshot;
      tooltipEditSnapshot = null;
      tooltipState = null;
      hideTooltip();
      render();
      return;
    }

    if (tooltipState) {
      // renderTooltipEdit() eagerly sets slot.connections = [] so there's
      // always an array to push rows onto; if the user added nothing (or
      // removed everything back down to zero), drop the key entirely so an
      // untouched device's data -- and a no-op open/close -- stay unchanged.
      var slot = findSlot(tooltipState.rackId, tooltipState.uPosition, tooltipState.position);
      if (slot && slot.connections && !slot.connections.length) delete slot.connections;
    }

    var changed = JSON.stringify(state) !== JSON.stringify(tooltipEditSnapshot);
    tooltipState = null;
    hideTooltip();
    if (changed) {
      pendingSnapshot = tooltipEditSnapshot;
      tooltipEditSnapshot = null;
      commitChange();
    } else {
      tooltipEditSnapshot = null;
    }
  }

  // ================= Patch list modal =================

  function buildPatchListRows() {
    var rows = [];
    state.racks.forEach(function (rack) {
      var slotsSorted = rack.slots.slice().sort(function (a, b) { return a.uPosition - b.uPosition; });
      slotsSorted.forEach(function (slot) {
        if (!slot.connections || !slot.connections.length) return;
        var gear = gearById[slot.gearId];
        var deviceName = gear ? gear.name : 'Unknown device';
        if (slot.label) deviceName += ' (' + slot.label + ')';
        slot.connections.forEach(function (conn) {
          rows.push({
            rackName: rack.name,
            deviceName: deviceName,
            direction: conn.direction,
            description: conn.description,
            patchedTo: conn.patchedTo
          });
        });
      });
    });
    return rows;
  }

  function openPatchListModal() {
    closeTooltipIfAny();

    var overlay = document.createElement('div');
    overlay.className = 'rb-modal-overlay';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePatchListModal();
    });

    var modal = document.createElement('div');
    modal.className = 'rb-modal';

    var header = document.createElement('div');
    header.className = 'rb-modal-header';
    var title = document.createElement('h2');
    title.textContent = 'Patch List';
    header.appendChild(title);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'rb-modal-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close patch list');
    closeBtn.addEventListener('click', closePatchListModal);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    var rows = buildPatchListRows();
    if (!rows.length) {
      var empty = document.createElement('p');
      empty.className = 'rb-modal-empty';
      empty.textContent = 'No patch connections have been added yet. Hover any placed device and click its tooltip to add one.';
      modal.appendChild(empty);
    } else {
      var tableWrap = document.createElement('div');
      tableWrap.className = 'rb-modal-table-wrap';
      var table = document.createElement('table');
      table.className = 'rb-modal-table';
      table.innerHTML = '<thead><tr><th>Rack</th><th>Device</th><th></th><th>Description</th><th>Patched To</th></tr></thead>';
      var tbody = document.createElement('tbody');
      rows.forEach(function (r) {
        var tr = document.createElement('tr');
        var arrow = r.direction === 'out' ? '→' : '←';
        tr.innerHTML =
          '<td>' + escapeHtml(r.rackName) + '</td>' +
          '<td>' + escapeHtml(r.deviceName) + '</td>' +
          '<td class="rb-modal-arrow">' + arrow + '</td>' +
          '<td>' + escapeHtml(r.description || '') + '</td>' +
          '<td>' + escapeHtml(r.patchedTo || '') + '</td>';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      modal.appendChild(tableWrap);
    }

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    patchListOverlayEl = overlay;
  }

  function closePatchListModal() {
    if (patchListOverlayEl) {
      patchListOverlayEl.remove();
      patchListOverlayEl = null;
    }
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
    img.src = gearImageUrl(gear);
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

  function setBodyNoSelect(on) {
    document.body.style.userSelect = on ? 'none' : '';
    document.body.style.webkitUserSelect = on ? 'none' : '';
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
    var sourceRack = state.racks.find(function (r) { return r.id === rackId; });
    var sourceSlot = sourceRack && sourceRack.slots.find(function (s) {
      return s.uPosition === uPosition && s.position === position;
    });
    dragCtx = {
      type: 'placed',
      gearId: gear.id,
      sourceRackId: rackId,
      sourceUPosition: uPosition,
      sourcePosition: position,
      sourceLabel: sourceSlot && sourceSlot.label,
      sourceConnections: sourceSlot && sourceSlot.connections,
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
    setBodyNoSelect(false);
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
    addSlot(hover.rackId, hover.uPosition, hover.targetPosition, dragCtx.gearId, dragCtx.sourceLabel, dragCtx.sourceConnections);
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
    setBodyNoSelect(true);
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
    setBodyNoSelect(false);
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
    setBodyNoSelect(true);
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
    setBodyNoSelect(false);
    var rack = state.racks.find(function (r) { return r.id === dragCtx.rackId; });
    if (rack && rack.uHeight !== dragCtx.startUHeight) {
      commitChange();
    } else {
      pendingSnapshot = null;
    }
  }

  // ================= Drag: sidebar resize =================

  function startSidebarResizeDrag(e, handleEl) {
    handleEl.classList.add('rb-resizing');
    setBodyNoSelect(true);
    dragCtx = {
      type: 'sidebar-resize',
      handleEl: handleEl,
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
    dragCtx.handleEl.classList.remove('rb-resizing');
    setBodyNoSelect(false);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(sidebarEl.getBoundingClientRect().width)));
    } catch (err) { /* non-critical */ }
  }

  // ================= Drag dispatch =================

  function onDragMove(e) {
    if (!dragCtx) return;
    if (dragCtx.type === 'library' || dragCtx.type === 'placed') {
      if (!dragCtx.started) {
        var dx = e.clientX - dragCtx.startX, dy = e.clientY - dragCtx.startY;
        if (Math.hypot(dx, dy) < 4) return;
        dragCtx.started = true;
        setBodyNoSelect(true);
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
    if (type === 'library' || type === 'placed') finishGearDrag(e);
    else if (type === 'rack') finishRackDrag();
    else if (type === 'resize') finishResizeDrag();
    else if (type === 'sidebar-resize') finishSidebarResizeDrag();

    dragCtx = null;
  }

  function cancelActiveDrag() {
    if (!dragCtx) return;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);
    document.removeEventListener('pointercancel', onDragEnd);

    setBodyNoSelect(false);
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
    if (dragCtx.type === 'sidebar-resize') {
      sidebarEl.style.width = dragCtx.startWidth + 'px';
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
    patchListBtn = document.getElementById('rb-patch-list');
  }

  function wireEvents() {
    document.addEventListener('pointerdown', function (e) {
      if (dragCtx) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;

      if (tooltipState && tooltipState.mode === 'edit' && !e.target.closest('.rb-tooltip')) {
        finishTooltipEdit(false);
        return;
      }

      var rackEl = e.target.closest('.rb-rack');
      if (rackEl) bringRackToFront(rackEl.dataset.rackId, rackEl);

      var resizeHandle = e.target.closest('.rb-resize-handle');
      if (resizeHandle) { e.preventDefault(); startResizeDrag(e, resizeHandle); return; }

      var sidebarResizeHandle = e.target.closest('.rb-sidebar-resize');
      if (sidebarResizeHandle) { e.preventDefault(); startSidebarResizeDrag(e, sidebarResizeHandle); return; }

      var gearItem = e.target.closest('.rb-gear-item');
      if (gearItem) { e.preventDefault(); startLibraryGearDrag(e, gearItem); return; }

      var placedGear = e.target.closest('.rb-gear-placed');
      if (placedGear && !e.target.closest('.rb-gear-remove') && !e.target.closest('.rb-gear-custom-label')) {
        e.preventDefault();
        startPlacedGearDrag(e, placedGear);
        return;
      }

      var titlebar = e.target.closest('.rb-rack-titlebar');
      if (titlebar && !e.target.closest('.rb-rack-name') && !e.target.closest('.rb-rack-delete')) {
        e.preventDefault();
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
      var nameInput = e.target.closest ? e.target.closest('.rb-rack-name') : null;
      if (nameInput) {
        var rackEl = nameInput.closest('.rb-rack');
        var rack = state.racks.find(function (r) { return r.id === rackEl.dataset.rackId; });
        if (!rack) return;
        var newName = nameInput.value.trim() || 'Untitled rack';
        if (newName !== rack.name) {
          rack.name = newName;
          applyMinorChange();
        } else {
          nameInput.value = rack.name;
        }
        return;
      }

      var labelInput = e.target.closest ? e.target.closest('.rb-gear-custom-label') : null;
      if (labelInput) {
        var placedEl = labelInput.closest('.rb-gear-placed');
        if (!placedEl) return;
        var placedRack = state.racks.find(function (r) { return r.id === placedEl.dataset.rackId; });
        if (!placedRack) return;
        var uPosition = parseInt(placedEl.dataset.uPosition, 10);
        var position = placedEl.dataset.position;
        var slot = placedRack.slots.find(function (s) { return s.uPosition === uPosition && s.position === position; });
        if (!slot) return;
        var newLabel = labelInput.value.trim();
        var oldLabel = slot.label || '';
        if (newLabel !== oldLabel) {
          if (newLabel) slot.label = newLabel; else delete slot.label;
          applyMinorChange();
        }
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && patchListOverlayEl) { closePatchListModal(); return; }
      if (e.key === 'Escape' && tooltipState && tooltipState.mode === 'edit') { finishTooltipEdit(true); return; }
      if (e.key === 'Escape' && dragCtx) { cancelActiveDrag(); return; }
      if ((e.target.matches('.rb-rack-name') || e.target.matches('.rb-gear-custom-label')) && e.key === 'Enter') {
        e.target.blur();
        return;
      }
      if (e.target.matches('input, textarea, select')) return;
      if (tooltipState && tooltipState.mode === 'edit') return;
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
    patchListBtn.addEventListener('click', openPatchListModal);

    canvasViewportEl.addEventListener('scroll', function () {
      closeTooltipIfAny();
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
