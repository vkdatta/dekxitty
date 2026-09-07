/**
 * DexLabs Sidebar 2 — Revamped
 * ─────────────────────────────────────────────────────────────────────────────
 * No static function HTML in index.html.
 * Everything is driven by FunctionRegistry + GrandFunctions.
 *
 * Structure inside the sidebar card — matches OG sidebar order:
 *   1. Search bar              ← top (restored to OG position)
 *   2. Quick-action grid       (font-size, clipboard)
 *   3. Static items            (Settings, Rename, Download) — top-level style
 *   4. Categories              (functions added to userDb from GF)
 *   5. [Grand Functions]       → opens GrandFunctions overlay
 *
 * Fixes vs. broken version:
 *   - FIX 1: Search moved back to top (OG: insertSearchAndPinnedUI ran first)
 *   - FIX 2: Pins section removed entirely (never existed in OG sidebar)
 *   - FIX 3: Static item headers get paddingLeft: 12px (OG depth-0 indent)
 *   - FIX 4: Category headers get paddingLeft: 12px (depth-0 indent)
 *   - FIX 5: Sub-items get paddingLeft: 32px (depth-1: 12 + 20)
 *   - FIX 6: --vline-left hardcoded to 19px (OG formula: totalLeft + 7 = 19)
 *            instead of rAF getBoundingClientRect which fires too late
 *   - FIX 7: Grand Functions rendered as plain non-collapse tree item
 *            (no divider, no sb2-grand-btn border/bg, no right arrow icon)
 *
 * Recursive tree rendering (v2):
 *   - refreshCategories() now calls FunctionRegistry.buildTree() and renders
 *     the result recursively via renderTreeNode(node, parentEl, depth).
 *   - Supports unlimited nesting depth — no code changes needed when new
 *     sub-levels are added to the registry.
 *   - Indentation: BASE(12) + depth*STEP(20)px; vline: indent + 7px.
 *   - Accordion is local to each level (siblings of the toggled node only).
 *   - Search: filterNode() prunes the tree recursively; matching branches
 *     are auto-expanded; non-matching branches are hidden entirely.
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  // ── Elements ──────────────────────────────────────────────────────────────
  const hamburger   = document.getElementById('secondary-sidebar-button');
  const overlay     = document.getElementById('secondary-sidebar-overlay');
  const sidebar     = document.getElementById('secondary-sidebar');
  const productCard = document.getElementById('secondary-sidebar-card');
  const cardScroll  = document.getElementById('secondary-sidebar-scroll');

  if (!hamburger || !overlay || !sidebar || !productCard || !cardScroll) return;

  // ── Open / Close ──────────────────────────────────────────────────────────
  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    sidebar.setAttribute('aria-hidden', 'false');
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.innerHTML = '<delluna-icon name="close"></delluna-icon>';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    sidebar.setAttribute('aria-hidden', 'true');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.innerHTML = '<delluna-icon name="view_cozy"></delluna-icon>';
  }

  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });
  sidebar.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!sidebar.classList.contains('open')) return;
    if (!sidebar.contains(e.target) && !hamburger.contains(e.target)) closeSidebar();
  });

  // ── UserDb loader ─────────────────────────────────────────────────────────
  function loadUserDb() {
    try { return new Map(JSON.parse(localStorage.getItem('dexGfUserDb') || '[]')); }
    catch (e) { return new Map(); }
  }

  // ── Search state ──────────────────────────────────────────────────────────
  let currentQuery = '';

  // ── Build entire sidebar card ─────────────────────────────────────────────
  // FIX 1: Search is rendered FIRST, matching the OG insertSearchAndPinnedUI
  //        call which prepended search to cardScroll before buildTopLevel ran.
  function buildSidebar2() {
    cardScroll.innerHTML = '';
    renderQuickActions();      // 1  font-size + clipboard grid
    renderStaticItems();       // 2  Settings / Rename / Download — top-level style
    renderSearchBar();         // 3  search — below Download Note, above Categories
    renderCategoriesGroup();   // 4  "Categories" collapsible wrapper (OG icon + structure)
    renderGrandFunctionsBtn(); // 5  Grand Functions launch row
  }

  // ── 1. Search ─────────────────────────────────────────────────────────────
  function renderSearchBar() {
    const wrap = document.createElement('div');
    wrap.className = 'sb2-search-wrap';

    const input = document.createElement('input');
    input.type         = 'text';
    input.id           = 'sidebar2Search';
    input.className    = 'sidebar2-search';
    input.placeholder  = 'Search functions…';
    input.autocomplete = 'off';
    input.spellcheck   = false;
    input.value        = currentQuery;

    input.addEventListener('input', () => {
      currentQuery = input.value;
      applySearch(currentQuery);
    });

    wrap.appendChild(input);
    cardScroll.appendChild(wrap);
  }

  // ── 2. Quick-action grid ──────────────────────────────────────────────────
  function renderQuickActions() {
    // Font size control
    const fsc = document.createElement('div');
    fsc.className = 'secondary-sidebar-item font-size-control';
    fsc.innerHTML = `
      <button onclick="decreaseFontSize()" style="background:var(--matte)">
        <delluna-icon name="remove"></delluna-icon>
      </button>
      <span>Font Size</span>
      <button onclick="increaseFontSize()" style="background:var(--matte)">
        <delluna-icon name="add"></delluna-icon>
      </button>`;
    cardScroll.appendChild(fsc);

    // Clipboard icon grid
    const grid = document.createElement('div');
    grid.className = 'secondary-sidebar-grid';
    const gridItems = [
      { icon: 'select_all',    onclick: 'handleSelectAll()' },
      { icon: 'content_copy',  onclick: 'handleCopyNote()' },
      { icon: 'content_cut',   onclick: 'handleCutNote()' },
      { icon: 'clear_all',     onclick: 'handleClearNote()' },
      { icon: 'content_paste', onclick: 'handlePasteNote()' },
    ];
    gridItems.forEach(it => {
      const btn = document.createElement('div');
      btn.className = 'secondary-sidebar-grid-item';
      btn.setAttribute('onclick', it.onclick);
      btn.innerHTML = `<delluna-icon name="${it.icon}"></delluna-icon>`;
      grid.appendChild(btn);
    });
    cardScroll.appendChild(grid);
  }

  // ── 3. Static items ───────────────────────────────────────────────────────
  // FIX 3: paddingLeft: 12px matches OG depth-0 indent
  //        (baseLeft=12, depth=0, so totalLeft=12).
  function renderStaticItems() {
    const staticItems = [
      { icon: 'tune',     text: 'Settings',     onclick: 'openSettingsManager()' },
      { icon: 'edit',     text: 'Rename',        onclick: 'handleRename()' },
      { icon: 'download', text: 'Download Note', onclick: 'handleDownload()' },
    ];

    staticItems.forEach(it => {
      const group = document.createElement('div');
      group.className = 'secondary-sidebar-category-group';

      const btn = document.createElement('button');
      btn.type              = 'button';
      btn.className         = 'secondary-sidebar-category-header';
      btn.style.paddingLeft = '12px'; // FIX 3
      btn.setAttribute('onclick', it.onclick);

      const left = document.createElement('span');
      left.className = 'secondary-sidebar-left';

      const ic = document.createElement('delluna-icon');
      ic.setAttribute('name', it.icon);

      const label = document.createElement('span');
      label.className   = 'secondary-sidebar-label';
      label.textContent = it.text;

      left.append(ic, label);
      btn.appendChild(left);
      // No chevron — non-collapse items
      group.appendChild(btn);
      cardScroll.appendChild(group);
    });
  }

  // ── 4. Categories group — OG "Categories" collapsible wrapping all L1s ───
  // Matches the original HTML: <div class='collapse open' icon='category' text='Categories'>
  function renderCategoriesGroup() {
    // Outer "Categories" collapsible — depth-0, OG icon = 'category'
    const outerGroup = document.createElement('div');
    outerGroup.id        = 'sidebar2CategoriesOuter';
    outerGroup.className = 'secondary-sidebar-category-group has-line open';
    outerGroup.style.setProperty('--vline-left', '19px');

    const outerHeader = document.createElement('button');
    outerHeader.type              = 'button';
    outerHeader.className         = 'secondary-sidebar-category-header';
    outerHeader.style.paddingLeft = '12px';
    outerHeader.setAttribute('aria-expanded', 'true');
    outerHeader.innerHTML = `
      <span class="secondary-sidebar-left">
        <delluna-icon name="category"></delluna-icon>
        <span class="secondary-sidebar-label">Categories</span>
      </span>
      <delluna-icon name="expand_more" class="secondary-sidebar-chevron"></delluna-icon>`;

    const outerContent = document.createElement('div');
    outerContent.id        = 'sidebar2Categories';
    outerContent.className = 'secondary-sidebar-category-content';
    outerContent.setAttribute('aria-hidden', 'false');
    outerContent.style.height = 'auto';
    outerContent.style.overflow = 'auto';

    outerHeader.addEventListener('click', () => toggleGroupInline(outerGroup, outerContent, outerHeader));

    outerGroup.appendChild(outerHeader);
    outerGroup.appendChild(outerContent);
    cardScroll.appendChild(outerGroup);

    // Set --line-top for outer group
    requestAnimationFrame(() => {
      outerGroup.style.setProperty('--line-top', outerHeader.offsetHeight + 'px');
    });

    refreshCategories(outerContent);
  }

  // ── Indentation constants ─────────────────────────────────────────────────
  // depth 0 = "Categories" header (rendered by renderCategoriesGroup)
  // depth 1 = L1 nodes (e.g. Formatting)   → paddingLeft = BASE + 1*STEP = 32px
  // depth 2 = L2 nodes (e.g. Basic)         → paddingLeft = BASE + 2*STEP = 52px
  // depth N = BASE + N*STEP
  // Vertical line sits 7px right of the icon column start:
  //   vline-left = BASE + depth*STEP + LINE_OFFSET
  const INDENT_BASE = 12;
  const INDENT_STEP = 20;
  const LINE_OFFSET = 7;

  function indentPx(depth)   { return INDENT_BASE + depth * INDENT_STEP; }
  function vlinePx(depth)    { return indentPx(depth) + LINE_OFFSET; }

  // ── Recursive tree renderer ───────────────────────────────────────────────
  /**
   * Render a tree node (L1 or any sub-level) into parentElement.
   *
   * @param {Object}  node          - normalised registry node
   * @param {Element} parentEl      - element to append into
   * @param {number}  depth         - current depth (1 = L1 inside Categories)
   * @param {boolean} forceExpand   - true when search is active and node matches
   */
  function renderTreeNode(node, parentEl, depth, forceExpand) {
    const hasChildren    = node.children && node.children.length > 0;
    const hasLeaves      = node.leaves    && node.leaves.length    > 0;
    const hasDirectLeaves= node.directLeaves && node.directLeaves.length > 0;
    const isEmpty = !hasChildren && !hasLeaves && !hasDirectLeaves;
    if (isEmpty) return;

    const group = document.createElement('div');
    group.className = 'secondary-sidebar-nav-item-group has-line';
    group.style.setProperty('--vline-left', vlinePx(depth) + 'px');

    const toggle = document.createElement('button');
    toggle.type              = 'button';
    toggle.className         = 'secondary-sidebar-nav-toggle';
    toggle.style.paddingLeft = indentPx(depth) + 'px';

    // Only L1 nodes have a registered icon; deeper nodes are text-only labels
    const iconHtml = node.icon
      ? `<delluna-icon name="${escHtml(node.icon)}"></delluna-icon>`
      : '';

    toggle.innerHTML = `
      <span class="secondary-sidebar-left">
        ${iconHtml}
        <span class="secondary-sidebar-label">${escHtml(node.name)}</span>
      </span>
      <delluna-icon name="expand_more" class="secondary-sidebar-chevron"></delluna-icon>`;

    const subList = document.createElement('div');
    subList.className = 'secondary-sidebar-sub-list';

    // Accordion: siblings at the same level close when this one opens.
    // Use :scope so we only target direct-children of parentEl, not
    // descendants — keeps deeply nested branches independent.
    toggle.addEventListener('click', () => {
      const isOpen = group.classList.contains('open');
      if (!isOpen) {
        // Close sibling groups only (direct children of same parent)
        Array.from(parentEl.children).forEach(sibling => {
          if (sibling === group) return;
          if (!sibling.classList.contains('secondary-sidebar-nav-item-group')) return;
          if (!sibling.classList.contains('open')) return;
          const sibContent = sibling.querySelector(':scope > .secondary-sidebar-sub-list');
          const sibToggle  = sibling.querySelector(':scope > .secondary-sidebar-nav-toggle');
          if (sibContent) {
            sibContent.style.height = sibContent.scrollHeight + 'px';
            requestAnimationFrame(() => { sibContent.style.height = '0'; });
            setTimeout(() => { sibContent.style.height = ''; }, 350);
            sibContent.setAttribute('aria-hidden', 'true');
          }
          if (sibToggle) sibToggle.setAttribute('aria-expanded', 'false');
          sibling.classList.remove('open');
        });
      }
      toggleGroupInline(group, subList, toggle);
    });

    // ── FIX 2: All category nodes start collapsed; only search (forceExpand) opens them ──
    // The outer "Categories" wrapper (depth=0) is handled by renderCategoriesGroup
    // and always starts open — that is the level-0 node that should be open.
    // L1 nodes (Formatting, Document…) and deeper all start collapsed.
    const shouldOpen = forceExpand;
    if (shouldOpen) {
      group.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      subList.setAttribute('aria-hidden', 'false');
      subList.style.height = 'auto';
    } else {
      // collapsed — reset the defaults set above
      toggle.setAttribute('aria-expanded', 'false');
      subList.setAttribute('aria-hidden', 'true');
      subList.style.height = '0';
    }
    if (forceExpand) {
      group.dataset.searchExpanded = 'true';
    }

    group.appendChild(toggle);
    group.appendChild(subList);
    parentEl.appendChild(group);

    // Direct leaves (functions registered directly under an L1 with no sub-level)
    if (hasDirectLeaves) {
      node.directLeaves.forEach(fn => {
        subList.appendChild(makeLeafButton(fn.icon, fn.name, fn.onclick, fn.batch, fn.id, indentPx(depth + 1)));
      });
    }

    // Recurse into children (sub-levels)
    if (hasChildren) {
      node.children.forEach(child => {
        renderTreeNode(child, subList, depth + 1, forceExpand);
      });
    }

    // Leaves of this node (functions at the exact under[] depth of this node)
    if (hasLeaves) {
      node.leaves.forEach(fn => {
        subList.appendChild(makeLeafButton(fn.icon, fn.name, fn.onclick, fn.batch, fn.id, indentPx(depth + 1)));
      });
    }

    // Set --line-top after layout
    requestAnimationFrame(() => {
      group.style.setProperty('--line-top', toggle.offsetHeight + 'px');
    });
  }

  // ── Filter tree for search ────────────────────────────────────────────────
  /**
   * Recursively filter a normalised tree node against a query string.
   * Returns a filtered clone if anything matches, or null if nothing matches.
   * Matching checks function names AND hierarchy labels.
   */
  function filterNode(node, q) {
    // Does this node's own label match?
    const labelMatch = node.name.toLowerCase().includes(q);

    // Filter direct leaves
    const matchedDirectLeaves = (node.directLeaves || []).filter(fn =>
      fn.name.toLowerCase().includes(q) ||
      (fn.under || []).join(' ').toLowerCase().includes(q)
    );

    // Filter regular leaves
    const matchedLeaves = (node.leaves || []).filter(fn =>
      fn.name.toLowerCase().includes(q) ||
      (fn.under || []).join(' ').toLowerCase().includes(q)
    );

    // Recurse into children
    const matchedChildren = (node.children || [])
      .map(child => filterNode(child, q))
      .filter(Boolean);

    const hasAnyMatch = matchedDirectLeaves.length || matchedLeaves.length || matchedChildren.length;

    if (!hasAnyMatch) {
      // No descendants match. If the label itself matches, keep the whole subtree.
      if (labelMatch) return node;
      return null;
    }

    // Return a shallow clone with only the matching subtree
    return {
      ...node,
      directLeaves: matchedDirectLeaves,
      leaves:       matchedLeaves,
      children:     matchedChildren,
    };
  }

  // ── Prune tree to only starred (userDb) functions ────────────────────────
  // Recursively strips leaves that are not starred, then drops empty branches.
  function pruneToStarred(node, starredIds) {
    const prunedDirectLeaves = (node.directLeaves || []).filter(fn => starredIds.has(fn.id));
    const prunedLeaves       = (node.leaves       || []).filter(fn => starredIds.has(fn.id));
    const prunedChildren     = (node.children     || [])
      .map(child => pruneToStarred(child, starredIds))
      .filter(Boolean);

    const hasContent = prunedDirectLeaves.length || prunedLeaves.length || prunedChildren.length;
    if (!hasContent) return null; // drop empty branch entirely

    return { ...node, directLeaves: prunedDirectLeaves, leaves: prunedLeaves, children: prunedChildren };
  }

  function refreshCategories(section) {
    if (!section) section = document.getElementById('sidebar2Categories');
    if (!section) return;
    section.innerHTML = '';

    if (typeof FunctionRegistry === 'undefined') return;

    // Get the full tree from the registry
    let tree = FunctionRegistry.buildTree();
    if (!tree.length) return;

    // ── FIX 1: Only show functions that the user has starred in userDb ────
    const userDb     = loadUserDb();
    const starredIds = new Set(userDb.keys());
    tree = tree.map(l1 => pruneToStarred(l1, starredIds)).filter(Boolean);
    if (!tree.length) return;

    const q = currentQuery.toLowerCase().trim();

    // Filter the tree when searching
    if (q) {
      tree = tree.map(l1 => filterNode(l1, q)).filter(Boolean);
      if (!tree.length) return;
    }

    // Render each L1 node recursively (depth=1 because depth=0 is "Categories")
    tree.forEach(l1Node => {
      renderTreeNode(l1Node, section, 1, !!q);
    });
  }

  // ── 5. Grand Functions button ─────────────────────────────────────────────
  // FIX 7: Plain non-collapse tree item — no divider, no special border/bg,
  //         no right arrow. Identical structure to Settings/Rename/Download.
  function renderGrandFunctionsBtn() {
    const group = document.createElement('div');
    group.className = 'secondary-sidebar-category-group';

    const btn = document.createElement('button');
    btn.type              = 'button';
    btn.className         = 'secondary-sidebar-category-header';
    btn.style.paddingLeft = '12px';

    const left = document.createElement('span');
    left.className = 'secondary-sidebar-left';

    const ic = document.createElement('delluna-icon');
    ic.setAttribute('name', 'apps');

    const label = document.createElement('span');
    label.className   = 'secondary-sidebar-label';
    label.textContent = 'Grand Functions';

    left.append(ic, label);
    btn.appendChild(left);
    // No chevron, no right icon — non-collapse item
    group.appendChild(btn);

    btn.addEventListener('click', () => {
      if (window.GrandFunctions) {
        closeSidebar();
        window.GrandFunctions.open();
      }
    });

    cardScroll.appendChild(group);
  }

  // ── Leaf button factory ───────────────────────────────────────────────────
  // Used for category sub-items only (no pin buttons — pins removed).
  // indentPx: inline paddingLeft override for correct tree depth alignment.
  function makeLeafButton(icon, text, onclickJs, batch, fnId, indentPx) {
    const btn = document.createElement('button');
    btn.type           = 'button';
    btn.className      = 'secondary-sidebar-sub-item';
    btn.dataset.search = (text || '').toLowerCase();
    if (batch !== undefined && batch !== null) btn.dataset.batch = batch;
    if (fnId  !== undefined)                  btn.dataset.fnId  = fnId;
    if (onclickJs)    btn.setAttribute('onclick', onclickJs);
    if (indentPx !== undefined) btn.style.paddingLeft = indentPx + 'px';

    const ic = document.createElement('delluna-icon');
    ic.setAttribute('name', icon);
    btn.appendChild(ic);
    btn.appendChild(document.createTextNode(text));

    return btn;
  }

  // ── Inline collapsible toggle ─────────────────────────────────────────────
  function toggleGroupInline(group, content, header) {
    const isOpen = group.classList.contains('open');
    if (isOpen) {
      content.style.height = content.scrollHeight + 'px';
      requestAnimationFrame(() => { content.style.height = '0'; });
      group.classList.remove('open');
      header.setAttribute('aria-expanded', 'false');
      content.setAttribute('aria-hidden', 'true');
      setTimeout(() => { content.style.height = ''; }, 350);
    } else {
      group.classList.add('open');
      header.setAttribute('aria-expanded', 'true');
      content.setAttribute('aria-hidden', 'false');
      content.style.height = '0';
      requestAnimationFrame(() => { content.style.height = content.scrollHeight + 'px'; });
      setTimeout(() => { content.style.height = 'auto'; }, 350);
    }
  }

  // ── Search ────────────────────────────────────────────────────────────────
  // Tree-aware: re-renders the categories section with the filtered tree.
  // The recursive filterNode() / renderTreeNode() pipeline handles:
  //   - showing only matching branches
  //   - auto-expanding the full ancestor chain for every match
  //   - hiding the outer "Categories" group when nothing matches
  function applySearch(query) {
    const q = query.toLowerCase().trim();

    // Re-render the categories section with the current query applied
    const section = document.getElementById('sidebar2Categories');
    if (section) refreshCategories(section);

    // Show/hide the outer Categories collapsible depending on whether
    // anything rendered inside it
    const outerGroup = document.getElementById('sidebar2CategoriesOuter');
    if (outerGroup && section) {
      const hasContent = section.children.length > 0;
      outerGroup.style.display = (!q || hasContent) ? '' : 'none';

      // If searching and content is present, ensure the outer group is open
      if (q && hasContent) {
        const outerContent = outerGroup.querySelector('.secondary-sidebar-category-content');
        const outerHeader  = outerGroup.querySelector('.secondary-sidebar-category-header');
        if (outerContent && !outerGroup.classList.contains('open')) {
          outerGroup.classList.add('open');
          outerContent.style.height = 'auto';
          outerContent.removeAttribute('aria-hidden');
          if (outerHeader) outerHeader.setAttribute('aria-expanded', 'true');
        }
      }
    }
  }

  // ── Escape HTML ───────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  // ── Public refresh hooks (called by GrandFunctions after add/remove) ──────
  window.renderSidebar2Categories = () => {
    // sidebar2Categories is the inner content div inside the Categories collapsible
    const section = document.getElementById('sidebar2Categories');
    refreshCategories(section);
  };

  // ── Initial build ─────────────────────────────────────────────────────────
  buildSidebar2();

  // Expose for bootstrap.js / showHomepage()
  window.closeSidebar2 = closeSidebar;

})();
