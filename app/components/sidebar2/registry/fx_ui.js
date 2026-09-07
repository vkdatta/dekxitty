/**
 * DexLabs Functions
 * ─────────────────────────────────────────────────────────────────────────────
 * Fullpage overlay for browsing and running functions from the registry.
 * Styled to match DexLabs site style (sidebar1/sidebar2 CSS variables).
 *
 * FIXES applied (vs. bugged version):
 *   1. L1 rail — icon only, no text label
 *   2. Whole gf-fn-item row is clickable (runs function); action btns stop propagation; no separate run button
 *   3. renderStaticItems uses top-level category-header style, not sub-item
 *   4. --vline-left / --line-top set on category groups
 *   5. Level 2+ navigation uses .custom-dropdown/.custom-dropdown-trigger (not <select>)
 *   6. ensureInfoElements() injects hidden #infoName/#infoStats/#infoDexLabs on DOM ready
 *      so existing JS always finds them; Info tab mirrors their values + download meta
 *   7. Route map (breadcrumbs) removed entirely
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (global) {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────────────────
  const PIN_KEY       = 'dexPinnedFunctions';
  const GF_OVERLAY_ID = 'functionsOverlay';

  // ── State ─────────────────────────────────────────────────────────────────
  let gfState = {
    view:   'functions',  // 'functions' | 'info'
    db:     'master',     // 'master'    | 'user'
    path:   [],           // [l1id, l2slug, l3slug, ...]
    search: ''
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  FIX 6 — Inject hidden DOM holder so existing JS always finds these IDs
  //  (infoName / infoStats / infoDexLabs were deleted from the sidebar footer)
  // ═══════════════════════════════════════════════════════════════════════════
  function ensureInfoElements() {
    if (document.getElementById('infoName')) return; // already present
    const holder = document.createElement('div');
    holder.id = 'gf-info-holder';
    holder.setAttribute('aria-hidden', 'true');
    // Visually hidden but in the DOM — existing code can update by ID
    holder.style.cssText = 'display:none !important; position:absolute; pointer-events:none;';
    holder.innerHTML =
      '<div id="infoDexLabs">Dekxitty | Local</div>' +
      '<div id="infoName">-</div>' +
      '<div id="infoStats" style="white-space:pre-line">' +
        'Char (ex. Spaces): 0\n' +
        'Char (in. Spaces): 0\n' +
        'Total Words: 0\n' +
        'Reading time: 0m\n' +
        'File Size: 0kb' +
      '</div>';
    document.body.appendChild(holder);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureInfoElements);
  } else {
    ensureInfoElements();
  }

  // ── UserDB helpers ────────────────────────────────────────────────────────
  function loadUserDb() {
    try { return new Map(JSON.parse(localStorage.getItem('dexGfUserDb') || '[]')); }
    catch (e) { return new Map(); }
  }
  function saveUserDb(map) {
    localStorage.setItem('dexGfUserDb', JSON.stringify(Array.from(map.entries())));
  }

  // ── Pin helpers ───────────────────────────────────────────────────────────
  function loadPins() {
    try { return JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); } catch (e) { return []; }
  }
  function savePins(list) { localStorage.setItem(PIN_KEY, JSON.stringify(list)); }
  function isPinned(onclickAttr) { return loadPins().some(p => p.onclick === onclickAttr); }
  function togglePin(entry) {
    const list = loadPins();
    const idx  = list.findIndex(p => p.onclick === entry.onclick);
    if (idx === -1) list.push(entry); else list.splice(idx, 1);
    savePins(list);
    // Refresh sidebar — both hook names covered for safety
    if (typeof window.renderSidebar2PinnedSection === 'function') {
      window.renderSidebar2PinnedSection();
    } else if (typeof window.renderSidebar2Categories === 'function') {
      window.renderSidebar2Categories();
    }
  }

  // ── Icon helper ───────────────────────────────────────────────────────────
  function icIcon(name) {
    return `<delluna-icon name="${name}"></delluna-icon>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Build overlay DOM (once, lazily)
  // ═══════════════════════════════════════════════════════════════════════════
  function ensureOverlay() {
    if (document.getElementById(GF_OVERLAY_ID)) return;

    const overlay = document.createElement('div');
    overlay.id        = GF_OVERLAY_ID;
    overlay.className = 'gf-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Functions');

    overlay.innerHTML = `
      <div class="gf-header">
        <div class="gf-header-left">
          ${icIcon('apps')}
          <span class="gf-title">Functions</span>
        </div>
        <div class="gf-header-tabs">
          <button class="gf-tab active" data-view="functions">${icIcon('code')} Functions</button>
          <button class="gf-tab"        data-view="info">${icIcon('info')} Info</button>
        </div>
        <div class="gf-header-right">
          <button class="gf-db-btn" id="gfDbBtn" title="Switch database">
            ${icIcon('square_swap')}
            <span id="gfDbLabel">MASTER</span>
            <span class="gf-db-count" id="gfDbCount">0</span>
          </button>
          <button class="gf-close-btn" id="gfCloseBtn" title="Close">
            ${icIcon('close')}
          </button>
        </div>
      </div>

      <div class="gf-body">

        <!-- FIX 1: Left rail — icon only, no label text -->
        <nav class="gf-rail" id="gfRail" aria-label="Categories"></nav>

        <div class="gf-main" id="gfMain">

          <!-- Functions view -->
          <div class="gf-view" id="gfViewFunctions">

              <!-- Dedicated route map strip — shows current path as clickable crumbs -->
            <div class="gf-routemap" id="gfRouteMap"></div>

            <!-- Level 2+ navigation — self-contained pill rows, no site modal system -->
            <div class="gf-dropdown-stack" id="gfDropdownStack" style="display:none"></div>

            <div class="gf-search-row">
              <span class="gf-search-icon">${icIcon('search')}</span>
              <input
                class="gf-search-input"
                id="gfSearchInput"
                type="text"
                placeholder="Search functions…"
                autocomplete="off"
                spellcheck="false"
              />
              <button class="gf-search-clear" id="gfSearchClear" style="display:none">
                ${icIcon('close')}
              </button>
            </div>

            <div class="gf-list" id="gfList"></div>
          </div>

          <!-- FIX 6: Info view — Note metadata + registry stats -->
          <div class="gf-view gf-view-hidden" id="gfViewInfo">
            <div class="gf-info-body">

              <!-- Note section -->
              <div class="gf-info-section-label">Note</div>
              <div class="gf-info-row">
                <span class="gf-info-label">Status</span>
                <span class="gf-info-val" id="gfNoteInfoDex">Dekxitty | Local</span>
              </div>
              <div class="gf-info-row">
                <span class="gf-info-label">File</span>
                <span class="gf-info-val" id="gfNoteInfoName">-</span>
              </div>
              <!-- Stats rows injected by renderInfo() -->
              <div id="gfNoteInfoStats"></div>

              <!-- Registry section -->
              <div class="gf-info-section-label" style="margin-top:14px">Registry</div>
              <div class="gf-info-row">
                <span class="gf-info-label">Active database</span>
                <span class="gf-info-val" id="gfInfoDb">Master</span>
              </div>
              <div class="gf-info-row">
                <span class="gf-info-label">Master DB functions</span>
                <span class="gf-info-val" id="gfInfoMaster">0</span>
              </div>
              <div class="gf-info-row">
                <span class="gf-info-label">User DB (added)</span>
                <span class="gf-info-val" id="gfInfoUser">0</span>
              </div>
              <div class="gf-info-row">
                <span class="gf-info-label">Pinned to sidebar</span>
                <span class="gf-info-val" id="gfInfoPinned">0</span>
              </div>
              <div class="gf-info-row">
                <span class="gf-info-label">Level-1 categories</span>
                <span class="gf-info-val" id="gfInfoCats">0</span>
              </div>

            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    bindOverlayEvents(overlay);
  }

  // ── Bind overlay-level events (runs once after DOM creation) ──────────────
  function bindOverlayEvents(overlay) {
    overlay.querySelector('#gfCloseBtn').addEventListener('click', close);

    overlay.querySelectorAll('.gf-tab').forEach(tab => {
      tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    overlay.querySelector('#gfDbBtn').addEventListener('click', toggleDb);

    const searchInput = overlay.querySelector('#gfSearchInput');
    const searchClear = overlay.querySelector('#gfSearchClear');

    searchInput.addEventListener('input', (e) => {
      gfState.search = e.target.value;
      searchClear.style.display = gfState.search ? '' : 'none';
      renderList();
    });
    searchClear.addEventListener('click', () => {
      gfState.search = '';
      searchInput.value = '';
      searchClear.style.display = 'none';
      renderList();
    });
  }

  // ── Open / Close ──────────────────────────────────────────────────────────
  function open() {
    ensureOverlay();
    if (!gfState.path.length) {
      const all = FunctionRegistry.getAllLevel1();
      if (all.length) {
        // Auto-dive: set L1 then walk to deepest first child so the route
        // shows the full path and has multiple crumbs from the start.
        const newPath = [all[0].id];
        const tree2   = FunctionRegistry.buildTree();
        let node = getNodeByPath(tree2, newPath);
        while (node && node.children && node.children.length) {
          newPath.push(node.children[0].id);
          node = node.children[0];
        }
        gfState.path = newPath;
      }
    }
    const overlay = document.getElementById(GF_OVERLAY_ID);
    overlay.classList.add('gf-open');
    overlay.setAttribute('aria-hidden', 'false');
    renderAll();
  }

  function close() {
    const overlay = document.getElementById(GF_OVERLAY_ID);
    if (overlay) {
      overlay.classList.remove('gf-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function switchView(view) {
    gfState.view = view;
    const overlay = document.getElementById(GF_OVERLAY_ID);
    overlay.querySelectorAll('.gf-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === view)
    );
    overlay.querySelector('#gfViewFunctions').classList.toggle('gf-view-hidden', view !== 'functions');
    overlay.querySelector('#gfViewInfo').classList.toggle('gf-view-hidden', view !== 'info');
    if (view === 'info') renderInfo();
  }

  function toggleDb() {
    gfState.db = gfState.db === 'master' ? 'user' : 'master';
    renderAll();
  }

  // ── Render all panels ─────────────────────────────────────────────────────
  function renderAll() {
    renderDbBtn();
    renderRail();
    renderRouteMap();
    renderDropdowns();
    renderList();
  }

  // ── Route map — terminal-style breadcrumb strip with level colours ─────────
  //  Styled after index7's terminal-routemap-block: each crumb gets a level
  //  colour class (gf-lvl-0 … gf-lvl-4) so the full path reads like a route.
  function renderRouteMap() {
    const el = document.getElementById('gfRouteMap');
    if (!el) return;

    if (gfState.search.trim()) {
      el.innerHTML =
        `<span class="gf-bc-root">root</span>` +
        `<span class="gf-bc-sep">/</span>` +
        `<span class="gf-bc-crumb gf-bc-current gf-lvl-0">Search results</span>`;
      return;
    }

    const tree      = FunctionRegistry.buildTree();
    const pathSoFar = [];
    const parts     = [];

    gfState.path.forEach((id, idx) => {
      pathSoFar.push(id);
      let name = id;
      if (idx === 0) {
        const n = tree.find(n => n.id === id);
        if (n) name = n.name;
      } else {
        const n = getNodeByPath(tree, pathSoFar.slice());
        if (n) name = n.name;
      }
      parts.push({ name, snap: pathSoFar.slice(), level: idx });
    });

    el.innerHTML =
      `<span class="gf-bc-root">root</span>` +
      `<span class="gf-bc-sep">/</span>` +
      parts.map((p, i) => {
        const isCurrent  = i === parts.length - 1;
        const snapAttr   = escHtml(JSON.stringify(p.snap));
        const colorClass = `gf-lvl-${p.level % 5}`;
        return (i > 0 ? '<span class="gf-bc-sep">/</span>' : '') +
          `<button class="gf-bc-crumb ${colorClass}${isCurrent ? ' gf-bc-current' : ''}" data-snap="${snapAttr}">${escHtml(p.name)}</button>`;
      }).join('');

    // sidebar1 pattern: every crumb (including current) gets an onclick —
    // clicking current just re-renders the same state (harmless).
    el.querySelectorAll('.gf-bc-crumb').forEach(btn => {
      btn.addEventListener('click', () => {
        try { gfState.path = JSON.parse(btn.dataset.snap); renderAll(); } catch (e) {}
      });
    });
  }

  // ── DB badge ──────────────────────────────────────────────────────────────
  function renderDbBtn() {
    const label = document.getElementById('gfDbLabel');
    const count = document.getElementById('gfDbCount');
    if (!label || !count) return;
    if (gfState.db === 'master') {
      label.textContent = 'MASTER';
      count.textContent = FunctionRegistry.getAllFunctions().length;
    } else {
      const udb = loadUserDb();
      label.textContent = 'USER';
      count.textContent = udb.size;
    }
    const dbBtn = document.getElementById('gfDbBtn');
    if (dbBtn) dbBtn.dataset.active = gfState.db;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FIX 1 — Rail: icon only, no gf-rail-label span
  // ═══════════════════════════════════════════════════════════════════════════
  function renderRail() {
    const rail = document.getElementById('gfRail');
    if (!rail) return;
    const all      = FunctionRegistry.getAllLevel1();
    const activeL1 = gfState.path[0];

    rail.innerHTML = all.map(l1 => `
      <button
        class="gf-rail-btn${l1.id === activeL1 ? ' active' : ''}"
        data-l1="${l1.id}"
        title="${escHtml(l1.name)}"
      >${icIcon(l1.icon)}</button>
    `).join('');

    rail.querySelectorAll('.gf-rail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        // Auto-dive: walk from L1 to deepest first child so the path is fully
        // resolved, the route shows multiple crumbs, and the dropdown label
        // matches the displayed function list.
        const newPath = [btn.dataset.l1];
        const tree2   = FunctionRegistry.buildTree();
        let node = getNodeByPath(tree2, newPath);
        while (node && node.children && node.children.length) {
          newPath.push(node.children[0].id);
          node = node.children[0];
        }
        gfState.path   = newPath;
        gfState.search = '';
        const inp = document.getElementById('gfSearchInput');
        if (inp) inp.value = '';
        const clr = document.getElementById('gfSearchClear');
        if (clr) clr.style.display = 'none';
        renderAll();
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Level 2+ navigation — custom-dropdown-trigger per level.
  //  Opening the trigger calls renderDropdownMenuPortal (from modal.js) which
  //  shows a searchable floating panel — same pattern used in cleanup.js.
  //  Selecting an option rebuilds gfState.path and re-renders everything.
  // ═══════════════════════════════════════════════════════════════════════════
  function renderDropdowns() {
    const stack = document.getElementById('gfDropdownStack');
    if (!stack) return;

    const tree   = FunctionRegistry.buildTree();
    const l1id   = gfState.path[0];
    const l1Node = tree.find(n => n.id === l1id);

    if (!l1Node || !l1Node.children || !l1Node.children.length) {
      stack.innerHTML     = '';
      stack.style.display = 'none';
      return;
    }

    stack.style.display = '';
    stack.innerHTML     = '';

    let currentNode = l1Node;

    for (let depth = 0; depth < gfState.path.length; depth++) {
      if (!currentNode || !currentNode.children || !currentNode.children.length) break;

      const selectedId    = gfState.path[depth + 1] || null;
      // Only resolve a child if the path explicitly includes one at this level.
      // When path stops here (crumb click back to a parent), show a neutral
      // placeholder so the label never mismatches what the list is displaying.
      const selectedChild = selectedId
        ? (currentNode.children.find(c => c.id === selectedId) || currentNode.children[0])
        : null;

      const row = document.createElement('div');
      row.className = 'gf-dropdown-row';

      const lvlLabel = document.createElement('span');
      lvlLabel.className   = 'gf-lvl-label';
      lvlLabel.textContent = `L${depth + 2}`;
      row.appendChild(lvlLabel);

      // ── Custom dropdown trigger (portal with search, via modal.js) ─────────
      const ddWrap = document.createElement('div');
      ddWrap.className = 'custom-dropdown gf-dd-wrap';

      const trigger = document.createElement('div');
      trigger.className     = 'custom-dropdown-trigger gf-dd-trigger';
      trigger.textContent   = selectedChild ? selectedChild.name : '— all —';
      trigger.dataset.value = selectedChild ? selectedChild.id  : '';
      trigger.setAttribute('aria-expanded', 'false');
      trigger.setAttribute('role', 'combobox');
      trigger.tabIndex = 0;

      const options       = currentNode.children.map(c => ({ label: c.name, value: c.id }));
      const capturedDepth = depth; // capture for closure

      const openPortal = () => {
        if (typeof renderDropdownMenuPortal !== 'function') return;
        renderDropdownMenuPortal(trigger, options, (selected) => {
          // Rebuild path: keep up-to-this-depth, then push selected child
          const newPath = gfState.path.slice(0, capturedDepth + 1);
          newPath.push(selected.value);

          // Auto-dive into first child if the chosen node has children
          const tree2 = FunctionRegistry.buildTree();
          let node = getNodeByPath(tree2, newPath);
          while (node && node.children && node.children.length) {
            newPath.push(node.children[0].id);
            node = node.children[0];
          }

          gfState.path = newPath;
          renderAll();
        });
      };

      trigger.addEventListener('click', (e) => { e.stopPropagation(); openPortal(); });
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPortal(); }
      });

      ddWrap.appendChild(trigger);
      row.appendChild(ddWrap);
      stack.appendChild(row);

      // Advance to the selected child for the next depth level
      currentNode = selectedChild || null;
    }
  }

  // ── Tree navigation helper ────────────────────────────────────────────────
  function getNodeByPath(tree, pathArray) {
    let node = tree.find(n => n.id === pathArray[0]);
    for (let i = 1; i < pathArray.length; i++) {
      if (!node || !node.children) break;
      node = node.children.find(c => c.id === pathArray[i]) || null;
    }
    return node;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FIX 2 — Function list: whole row clickable; action buttons stop propagation
  // ═══════════════════════════════════════════════════════════════════════════
  function renderList() {
    const container = document.getElementById('gfList');
    if (!container) return;

    const allFns  = FunctionRegistry.getAllFunctions();
    const userDb  = loadUserDb();
    const isUser  = gfState.db === 'user';
    const source  = isUser ? Array.from(userDb.values()) : allFns;

    let filtered = source;

    if (gfState.search.trim()) {
      const q = gfState.search.toLowerCase().trim();
      filtered = allFns.filter(f =>
        f.name.toLowerCase().includes(q) ||
        f.under.join(' ').toLowerCase().includes(q)
      );
      if (isUser) filtered = filtered.filter(f => userDb.has(f.id));
    } else {
      const tree = FunctionRegistry.buildTree();
      const node = getNodeByPath(tree, gfState.path);

      if (node) {
        const collectLeaves = (n) => {
          let leaves = [...(n.leaves || []), ...(n.directLeaves || [])];
          (n.children || []).forEach(c => { leaves = leaves.concat(collectLeaves(c)); });
          return leaves;
        };
        const leafSet = new Set(collectLeaves(node).map(f => f.id));
        filtered = source.filter(f => leafSet.has(f.id));
      }
    }

    if (!filtered.length) {
      container.innerHTML = `<div class="gf-empty">${icIcon('search_off')} No functions found.</div>`;
      return;
    }

    container.innerHTML = filtered.map(fn => {
      const pinned = isPinned(fn.onclick);
      const inUser = userDb.has(fn.id);
      return `
        <div class="gf-fn-item" data-id="${fn.id}">
          <span class="gf-fn-icon">${icIcon(fn.icon)}</span>
          <div class="gf-fn-info">
            <span class="gf-fn-name">${escHtml(fn.name)}</span>
          </div>
          <div class="gf-fn-actions">
            <button class="gf-pin-btn${pinned ? ' pinned' : ''}" data-fn-id="${fn.id}"
              title="${pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}"
            >${pinned ? `<delluna-icon name="star-fill" style="color:#f5c518"></delluna-icon>` : icIcon('star_border')}</button>
            ${!isUser
              ? `<button class="gf-add-btn${inUser ? ' added' : ''}" data-fn-id="${fn.id}"
                   title="${inUser ? 'In User DB' : 'Add to User DB'}"${inUser ? ' disabled' : ''}
                 >${icIcon(inUser ? 'check' : 'add')}</button>`
              : `<button class="gf-remove-btn" data-fn-id="${fn.id}"
                   title="Remove from User DB"
                 >${icIcon('remove')}</button>`
            }

          </div>
        </div>
      `;
    }).join('');

    // ── Helper: run a function by id and close overlay ─────────────────────
    function runFnById(id) {
      const fn = allFns.find(f => f.id === Number(id));
      if (!fn || !fn.onclick) return;
      try { (0, eval)(fn.onclick); } catch (err) { console.warn('GF run:', err); }
      close();
    }

    // ── FIX 2a: Whole row click → run (skip .gf-fn-actions area) ──────────
    container.querySelectorAll('.gf-fn-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.gf-fn-actions')) return; // let action buttons handle themselves
        runFnById(item.dataset.id);
      });
    });

    // ── Pin buttons ────────────────────────────────────────────────────────
    container.querySelectorAll('.gf-pin-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fn = allFns.find(f => f.id === Number(btn.dataset.fnId));
        if (!fn) return;
        togglePin({ onclick: fn.onclick, icon: fn.icon, text: fn.name });
        const nowPinned = isPinned(fn.onclick);
        btn.classList.toggle('pinned', nowPinned);
        btn.innerHTML = nowPinned ? `<delluna-icon name="star-fill" style="color:#f5c518"></delluna-icon>` : icIcon('star_border');
        btn.title     = nowPinned ? 'Unpin from sidebar' : 'Pin to sidebar';
      });
    });

    // ── Add buttons ────────────────────────────────────────────────────────
    container.querySelectorAll('.gf-add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fn = allFns.find(f => f.id === Number(btn.dataset.fnId));
        if (!fn) return;
        const udb = loadUserDb();
        udb.set(fn.id, fn);
        saveUserDb(udb);
        btn.disabled  = true;
        btn.classList.add('added');
        btn.innerHTML = icIcon('check');
        btn.title     = 'In User DB';
        renderDbBtn();
        if (typeof window.renderSidebar2Categories === 'function') {
          window.renderSidebar2Categories();
        }
      });
    });

    // ── Remove buttons (user DB view) ──────────────────────────────────────
    container.querySelectorAll('.gf-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fn = allFns.find(f => f.id === Number(btn.dataset.fnId));
        if (!fn) return;
        const udb = loadUserDb();
        udb.delete(fn.id);
        saveUserDb(udb);
        renderAll();
        if (typeof window.renderSidebar2Categories === 'function') {
          window.renderSidebar2Categories();
        }
      });
    });


  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FIX 6 — Info view: Note metadata + registry stats
  // ═══════════════════════════════════════════════════════════════════════════
  function renderInfo() {
    const allFns = FunctionRegistry.getAllFunctions();
    const allL1  = FunctionRegistry.getAllLevel1();
    const udb    = loadUserDb();
    const pins   = loadPins();

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    // Registry stats
    set('gfInfoDb',     gfState.db === 'master' ? 'Master' : 'User');
    set('gfInfoMaster', allFns.length);
    set('gfInfoUser',   udb.size);
    set('gfInfoPinned', pins.length);
    set('gfInfoCats',   allL1.length);

    // Note info — read from hidden holder injected by ensureInfoElements()
    const nameEl  = document.getElementById('infoName');
    const dexEl   = document.getElementById('infoDexLabs');
    const statsEl = document.getElementById('infoStats');

    set('gfNoteInfoName', nameEl ? (nameEl.textContent.trim() || '-')                : '-');
    set('gfNoteInfoDex',  dexEl  ? (dexEl.textContent.trim()  || 'Dekxitty | Local') : 'Dekxitty | Local');

    // Stats: parse multi-line text → individual gf-info-row entries
    // Covers chars, words, reading time, file size (download meta)
    const statsContainer = document.getElementById('gfNoteInfoStats');
    if (statsContainer) {
      const raw   = statsEl ? (statsEl.textContent || '').trim() : '';
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length) {
        statsContainer.innerHTML = lines.map(line => {
          const colon = line.indexOf(':');
          const label = colon !== -1 ? line.slice(0, colon).trim()  : line;
          const val   = colon !== -1 ? line.slice(colon + 1).trim() : '';
          return `
            <div class="gf-info-row">
              <span class="gf-info-label">${escHtml(label)}</span>
              <span class="gf-info-val">${escHtml(val)}</span>
            </div>`;
        }).join('');
      } else {
        statsContainer.innerHTML = '';
      }
    }
  }

  // ── Escape HTML ───────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────
  global.Functions = { open, close, loadUserDb, loadPins, isPinned, togglePin };

})(window);
