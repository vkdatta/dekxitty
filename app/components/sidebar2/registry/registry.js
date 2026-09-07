/**
 * DexLabs Function Registry
 * ─────────────────────────────────────────────────────────────────────────────
 * Central registry for all Sidebar 2 Functions.
 * Designed to scale to 2000+ functions without touching any HTML.
 *
 * USAGE:
 *   FunctionRegistry.registerLevel1({
 *     id: 'formatting', name: 'Formatting', icon: 'format_color_fill'
 *   });
 *
 *   FunctionRegistry.register({
 *     function: 'handleUppercase',
 *     icon: 'uppercase',
 *     name: 'Uppercase',
 *     under: ['formatting', 'basic'],
 *     batch: 'file',
 *     onclick: 'handleUppercase()'
 *   });
 *
 * Structure:
 *   Level 1 = top-level category (needs icon — defined in registerLevel1)
 *   Level 2+ = sub-levels (no icons needed; auto-created from 'under' array)
 *   Leaf     = a runnable function entry
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (global) {
  'use strict';

  // ── Internal storage ────────────────────────────────────────────────────────
  const _level1Map = new Map();   // id → { id, name, icon }
  const _functions = [];          // All leaf function entries
  let   _idSeq     = 1;

  // ── Utility: generate a stable slug from a string ─────────────────────────
  function slug(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Register a Level-1 category (needs an icon).
   * @param {Object} def
   * @param {string} def.id    - stable unique id, e.g. 'formatting'
   * @param {string} def.name  - display label
   * @param {string} def.icon  - delluna-icon name
   */
  function registerLevel1(def) {
    if (!def || !def.id) throw new Error('registerLevel1: id required');
    _level1Map.set(def.id, {
      id:   def.id,
      name: def.name || def.id,
      icon: def.icon || 'folder'
    });
  }

  /**
   * Register a leaf function.
   * @param {Object} def
   * @param {string}   def.function  - function name / key
   * @param {string}   def.icon      - delluna-icon name
   * @param {string}   def.name      - display label
   * @param {string[]} def.under     - hierarchy path, e.g. ['formatting','basic']
   *                                   def.under[0] must match a registerLevel1 id
   * @param {string}   [def.batch]   - batch attribute (file | app | exclude | once:*)
   * @param {string}   [def.onclick] - JS to execute, default = def.function + '()'
   */
  function register(def) {
    if (!def || !def.function) throw new Error('register: function required');
    const under = Array.isArray(def.under) ? def.under : [def.under].filter(Boolean);
    _functions.push({
      id:      _idSeq++,
      fn:      def.function,
      icon:    def.icon     || 'code',
      name:    def.name     || def.function,
      under:   under,
      leafId:  slug(under[under.length - 1] || def.function),
      batch:   def.batch    || null,
      onclick: def.onclick  || (def.function + '()'),
    });
  }

  /**
   * Register multiple functions at once.
   * @param {Object[]} defs
   */
  function registerMany(defs) {
    (defs || []).forEach(register);
  }

  // ── Query API ───────────────────────────────────────────────────────────────

  function getAllLevel1()     { return Array.from(_level1Map.values()); }
  function getAllFunctions()  { return _functions.slice(); }

  function getLevel1(id)     { return _level1Map.get(id) || null; }

  /** Return all functions that belong to a given level-1 id. */
  function getFunctionsForLevel1(l1id) {
    return _functions.filter(f => f.under[0] === l1id);
  }

  /**
   * Build the full tree structure expected by Functions renderer.
   * Returns an array of Level-1 nodes, each with a nested 'children' tree.
   */
  function buildTree() {
    const tree = [];

    _level1Map.forEach(l1 => {
      const l1Node = { ...l1, children: new Map() };
      tree.push(l1Node);
    });

    _functions.forEach(fn => {
      const l1id = fn.under[0];
      const l1Node = tree.find(n => n.id === l1id);
      if (!l1Node) return; // orphan — skip

      // Build sub-level nodes on demand
      let currentChildren = l1Node.children;
      const subLevels = fn.under.slice(1);

      subLevels.forEach((lvlName, i) => {
        const lvlId = slug(lvlName);
        if (!currentChildren.has(lvlId)) {
          currentChildren.set(lvlId, {
            id:       lvlId,
            name:     lvlName,
            children: new Map(),
            leaves:   []
          });
        }
        const node = currentChildren.get(lvlId);
        if (i === subLevels.length - 1) {
          node.leaves.push(fn);
        } else {
          currentChildren = node.children;
        }
      });

      // If only 1 level deep (directly under l1), treat l1 as parent
      if (subLevels.length === 0) {
        if (!l1Node._directLeaves) l1Node._directLeaves = [];
        l1Node._directLeaves.push(fn);
      }
    });

    // Convert Maps to arrays recursively
    function normalizeNode(node) {
      const out = {
        id:       node.id,
        name:     node.name,
        icon:     node.icon || null,
        leaves:   node.leaves       || [],
        directLeaves: node._directLeaves || [],
        children: []
      };
      if (node.children instanceof Map) {
        node.children.forEach(child => out.children.push(normalizeNode(child)));
      }
      return out;
    }

    return tree.map(normalizeNode);
  }

  /**
   * Search all functions by name (case-insensitive substring).
   * Also searches the path labels.
   */
  function search(query) {
    if (!query) return _functions.slice();
    const q = query.toLowerCase().trim();
    return _functions.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.under.join(' ').toLowerCase().includes(q)
    );
  }

  // ── Expose ──────────────────────────────────────────────────────────────────
  global.FunctionRegistry = {
    registerLevel1,
    register,
    registerMany,
    getAllLevel1,
    getAllFunctions,
    getLevel1,
    getFunctionsForLevel1,
    buildTree,
    search
  };

})(typeof window !== 'undefined' ? window : global);


// ════════════════════════════════════════════════════════════════════════════
//  BUILT-IN LEVEL-1 CATEGORIES  (add yours here or call registerLevel1 later)
// ════════════════════════════════════════════════════════════════════════════

FunctionRegistry.registerLevel1({ id: 'formatting',  name: 'Formatting',  icon: 'format_color_fill' });
FunctionRegistry.registerLevel1({ id: 'operations',  name: 'Operations',  icon: 'discover_tune'     });
FunctionRegistry.registerLevel1({ id: 'code',        name: 'Code',        icon: 'code'              });
FunctionRegistry.registerLevel1({ id: 'document',    name: 'Document',    icon: 'description'       });


// ════════════════════════════════════════════════════════════════════════════
//  BUILT-IN FUNCTIONS  (migrated from static HTML sidebar 2)
// ════════════════════════════════════════════════════════════════════════════

FunctionRegistry.registerMany([

  // ── Formatting › Basic ────────────────────────────────────────────────────
  { function: 'handleUppercase',       icon: 'uppercase',             name: 'Uppercase',             under: ['formatting', 'Basic'], batch: 'file',    onclick: 'handleUppercase()' },
  { function: 'handleLowercase',       icon: 'lowercase',             name: 'Lowercase',             under: ['formatting', 'Basic'], batch: 'file',    onclick: 'handleLowercase()' },
  { function: 'capitalizeWords',       icon: 'match_case',            name: 'Capitalise Words',      under: ['formatting', 'Basic'], batch: 'file',    onclick: 'capitalizeWords()' },
  { function: 'capitalizeSentences',   icon: 'text_up',               name: 'Capitalise Sentences',  under: ['formatting', 'Basic'], batch: 'file',    onclick: 'capitalizeSentences()' },
  { function: 'reverseWords',          icon: 'arrow_left',            name: 'Reverse Words',         under: ['formatting', 'Basic'], batch: 'file',    onclick: 'reverseWords()' },
  { function: 'reverseText',           icon: 'fast_rewind',           name: 'Reverse All',           under: ['formatting', 'Basic'], batch: 'file',    onclick: 'reverseText()' },

  // ── Formatting › Alignment ────────────────────────────────────────────────
  { function: 'handleAlignLeft',       icon: 'format_align_left',     name: 'Align Left',            under: ['formatting', 'Alignment'], batch: 'file', onclick: 'handleAlignLeft()' },
  { function: 'handleAlignCenter',     icon: 'format_align_center',   name: 'Align Center',          under: ['formatting', 'Alignment'], batch: 'file', onclick: 'handleAlignCenter()' },
  { function: 'handleAlignRight',      icon: 'format_align_right',    name: 'Align Right',           under: ['formatting', 'Alignment'], batch: 'file', onclick: 'handleAlignRight()' },
  { function: 'decreaseIndentation',   icon: 'format_indent_decrease',name: 'Decrease Indentation',  under: ['formatting', 'Alignment'], batch: 'file', onclick: 'decreaseIndentation()' },
  { function: 'increaseIndentation',   icon: 'format_indent_increase',name: 'Increase Indentation',  under: ['formatting', 'Alignment'], batch: 'file', onclick: 'increaseIndentation()' },

  // ── Formatting › Markup / Markdown ───────────────────────────────────────
  { function: 'handleBold',            icon: 'format_bold',           name: 'Bold',                  under: ['formatting', 'Markup/Markdown'], onclick: "handleFormat('bold')" },
  { function: 'handleItalic',          icon: 'format_italic',         name: 'Italic',                under: ['formatting', 'Markup/Markdown'], onclick: "handleFormat('italic')" },
  { function: 'handleUnderline',       icon: 'format_underlined',     name: 'Underline',             under: ['formatting', 'Markup/Markdown'], onclick: "handleFormat('underline')" },
  { function: 'handleBulletList',      icon: 'format_list_bulleted',  name: 'Bullet List',           under: ['formatting', 'Markup/Markdown'], batch: 'file', onclick: 'handleBulletList()' },
  { function: 'handleNumberedList',    icon: 'format_list_numbered',  name: 'Numbered List',         under: ['formatting', 'Markup/Markdown'], batch: 'file', onclick: 'handleNumberedList()' },
  { function: 'handleCode',            icon: 'code',                  name: 'Code',                  under: ['formatting', 'Markup/Markdown'], onclick: "handleFormat('code')" },
  { function: 'handleInsertLink',      icon: 'link',                  name: 'Insert Link',           under: ['formatting', 'Markup/Markdown'], batch: 'exclude', onclick: 'handleInsertLink()' },
  { function: 'handleInsertImage',     icon: 'image',                 name: 'Insert Image',          under: ['formatting', 'Markup/Markdown'], batch: 'exclude', onclick: 'handleInsertImage()' },

  // ── Formatting › Designer Fonts ───────────────────────────────────────────
  { function: 'openFontPickerModal',   icon: 'slab_serif',            name: 'Designer Fonts',        under: ['formatting', 'Fonts'], batch: 'once:font', onclick: 'openFontPickerModal()' },

  // ── Operations ───────────────────────────────────────────────────────────
  { function: 'findandreplace',        icon: 'find_replace',          name: 'Find and Replace',      under: ['operations'], batch: 'app', onclick: 'findandreplace()' },
  { function: 'openChainPanel',        icon: 'link',                  name: 'Chains',                under: ['operations'], batch: 'app', onclick: 'window.openChainPanel && window.openChainPanel()' },
  { function: 'handleCleanupText',     icon: 'cleaning_services',     name: 'Cleanup Text',          under: ['operations'], batch: 'exclude', onclick: 'handleCleanupText()' },
  { function: 'handlePattern',         icon: 'swap_horiz',            name: 'Pattern Replacement',   under: ['operations'], batch: 'exclude', onclick: 'handlePattern()' },
  { function: 'handleAdd',             icon: 'add',                   name: 'Add Text',              under: ['operations'], batch: 'exclude', onclick: 'handleAdd()' },

  // ── Code ──────────────────────────────────────────────────────────────────
  { function: 'cipher',                icon: 'key',                   name: 'Cipher',                under: ['code'], batch: 'once:cipher', onclick: 'cipher()' },
  { function: 'MD5',                   icon: 'encrypted',             name: 'MD5 Hash',              under: ['code'], batch: 'file', onclick: 'MD5()' },
  { function: 'SHA256',                icon: 'encrypted',             name: 'SHA256 Hash',           under: ['code'], batch: 'file', onclick: 'SHA256()' },
  { function: 'handleRemoveHtml',      icon: 'html',                  name: 'Remove HTML',           under: ['code'], batch: 'file', onclick: 'handleRemoveHtml()' },
  { function: 'handleEscapeHtml',      icon: 'html',                  name: 'Escape HTML',           under: ['code'], batch: 'file', onclick: 'handleEscapeHtml()' },
  { function: 'handleUnescapeHtml',    icon: 'html',                  name: 'Unescape HTML',         under: ['code'], batch: 'file', onclick: 'handleUnescapeHtml()' },
  { function: 'handleTextToTable',     icon: 'table',                 name: 'Text To HTML Table',    under: ['code'], batch: 'once:tabletext', onclick: 'handleTextToTable()' },
  { function: 'optimisecss',           icon: 'css',                   name: 'Optimise CSS',          under: ['code'], batch: 'file', onclick: 'optimisecss()' },
  { function: 'minifycss',             icon: 'css',                   name: 'Minify CSS',            under: ['code'], batch: 'file', onclick: 'minifycss()' },
  { function: 'optimisejs',            icon: 'javascript',            name: 'Optimise JS',           under: ['code'], batch: 'file', onclick: 'optimisejs()' },
  { function: 'minifyjs',              icon: 'javascript',            name: 'Minify JS',             under: ['code'], batch: 'file', onclick: 'minifyjs()' },
  { function: 'handleLatex',           icon: 'data_object',           name: 'Handle Latex',          under: ['code'], batch: 'file', onclick: 'handleLatex()' },

  // ── Document ─────────────────────────────────────────────────────────────
  { function: 'openFetchModal',        icon: 'data_object',           name: 'Fetch URL',             under: ['document'], batch: 'exclude', onclick: 'openFetchModal()' },
  { function: 'handleOpenFile',        icon: 'folder_open',           name: 'Open File',             under: ['document'], batch: 'app', onclick: 'handleOpenFile()' },
  { function: 'debug',                 icon: 'bug_report',            name: 'Debug',                 under: ['document'], batch: 'app', onclick: 'debug()' },
  { function: 'forceSyncToCloud',      icon: 'cloud_upload',          name: 'Force Sync to Cloud',   under: ['document'], batch: 'app', onclick: 'forceSyncToCloud()' },
{ function: 'foldAll',                   icon: 'unfold_less',   name: 'Fold All',                    under: ['document'], onclick: 'foldAll()' },
{ function: 'unfoldAll',                 icon: 'unfold_more',   name: 'Unfold All',                  under: ['document'], onclick: 'unfoldAll()' },
{ function: 'removeContentInsideFolds',  icon: 'compress',      name: 'Remove Folded Contents',      under: ['document'], onclick: 'removeContentInsideFolds()' },
    
]);
