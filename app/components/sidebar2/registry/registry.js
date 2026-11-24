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
   * @param {boolean}  def.isAutomatable - REQUIRED tag. true only when the function is a
   *                   whole-document text action whose every input can be captured up front
   *                   (needs a matching entry in functions/2operations/automations.js).
   *                   false for anything that opens UI, needs a selection/cursor, or acts
   *                   on the app (Open File, Recover Versions, Debug, Sync, md block tools...).
   */
  function register(def) {
    if (!def || !def.function) throw new Error('register: function required');
    if (typeof def.isAutomatable !== 'boolean') {
      console.warn('FunctionRegistry: "' + def.function + '" has no isAutomatable tag (defaulting to false)');
    }
    const under = Array.isArray(def.under) ? def.under : [def.under].filter(Boolean);
    _functions.push({
      id:      _idSeq++,
      fn:      def.function,
      icon:    def.icon     || 'code',
      name:    def.name     || def.function,
      under:   under,
      leafId:  slug(under[under.length - 1] || def.function),
      batch:   def.batch    || null,
      isAutomatable: def.isAutomatable === true,
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
  function getAutomatableFunctions() { return _functions.filter(f => f.isAutomatable); }

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
    getAutomatableFunctions,
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
FunctionRegistry.registerLevel1({ id: 'transformer', name: 'Transformer', icon: 'swap_horiz'        });
// Markdown block tools — act on the open block while a .md file is in exec › Design (see mdexec/design.js)
FunctionRegistry.registerLevel1({ id: 'markdown',    name: 'Markdown',    icon: 'title'             });


// ════════════════════════════════════════════════════════════════════════════
//  BUILT-IN FUNCTIONS  (migrated from static HTML sidebar 2)
// ════════════════════════════════════════════════════════════════════════════

FunctionRegistry.registerMany([

  // ── Formatting › Basic ────────────────────────────────────────────────────
  { function: 'handleUppercase', isAutomatable: true,       icon: 'uppercase',             name: 'Uppercase',             under: ['formatting', 'Basic'], batch: 'file',    onclick: 'handleUppercase()' },
  { function: 'handleLowercase', isAutomatable: true,       icon: 'lowercase',             name: 'Lowercase',             under: ['formatting', 'Basic'], batch: 'file',    onclick: 'handleLowercase()' },
  { function: 'capitalizeWords', isAutomatable: true,       icon: 'match_case',            name: 'Capitalise Words',      under: ['formatting', 'Basic'], batch: 'file',    onclick: 'capitalizeWords()' },
  { function: 'capitalizeSentences', isAutomatable: true,   icon: 'text_up',               name: 'Capitalise Sentences',  under: ['formatting', 'Basic'], batch: 'file',    onclick: 'capitalizeSentences()' },
  { function: 'reverseWords', isAutomatable: true,          icon: 'arrow_left',            name: 'Reverse Words',         under: ['formatting', 'Basic'], batch: 'file',    onclick: 'reverseWords()' },
  { function: 'reverseText', isAutomatable: true,           icon: 'fast_rewind',           name: 'Reverse All',           under: ['formatting', 'Basic'], batch: 'file',    onclick: 'reverseText()' },

  // ── Formatting › Alignment ────────────────────────────────────────────────
  { function: 'handleAlignLeft', isAutomatable: false,       icon: 'format_align_left',     name: 'Align Left',            under: ['formatting', 'Alignment'], batch: 'file', onclick: 'handleAlignLeft()' },
  { function: 'handleAlignCenter', isAutomatable: false,     icon: 'format_align_center',   name: 'Align Center',          under: ['formatting', 'Alignment'], batch: 'file', onclick: 'handleAlignCenter()' },
  { function: 'handleAlignRight', isAutomatable: false,      icon: 'format_align_right',    name: 'Align Right',           under: ['formatting', 'Alignment'], batch: 'file', onclick: 'handleAlignRight()' },
  { function: 'decreaseIndentation', isAutomatable: true,   icon: 'format_indent_decrease',name: 'Decrease Indentation',  under: ['formatting', 'Alignment'], batch: 'file', onclick: 'decreaseIndentation()' },
  { function: 'increaseIndentation', isAutomatable: true,   icon: 'format_indent_increase',name: 'Increase Indentation',  under: ['formatting', 'Alignment'], batch: 'file', onclick: 'increaseIndentation()' },

  // ── Formatting › Markup / Markdown ───────────────────────────────────────
  { function: 'handleBold', isAutomatable: false,            icon: 'format_bold',           name: 'Bold',                  under: ['formatting', 'Markup/Markdown'], onclick: "handleFormat('bold')" },
  { function: 'handleItalic', isAutomatable: false,          icon: 'format_italic',         name: 'Italic',                under: ['formatting', 'Markup/Markdown'], onclick: "handleFormat('italic')" },
  { function: 'handleUnderline', isAutomatable: false,       icon: 'format_underlined',     name: 'Underline',             under: ['formatting', 'Markup/Markdown'], onclick: "handleFormat('underline')" },
  { function: 'handleBulletList', isAutomatable: true,      icon: 'format_list_bulleted',  name: 'Bullet List',           under: ['formatting', 'Markup/Markdown'], batch: 'file', onclick: 'handleBulletList()' },
  { function: 'handleNumberedList', isAutomatable: true,    icon: 'format_list_numbered',  name: 'Numbered List',         under: ['formatting', 'Markup/Markdown'], batch: 'file', onclick: 'handleNumberedList()' },
  { function: 'handleCode', isAutomatable: false,            icon: 'code',                  name: 'Code',                  under: ['formatting', 'Markup/Markdown'], onclick: "handleFormat('code')" },
  { function: 'handleInsertLink', isAutomatable: false,      icon: 'link',                  name: 'Insert Link',           under: ['formatting', 'Markup/Markdown'], batch: 'exclude', onclick: 'handleInsertLink()' },
  { function: 'handleInsertImage', isAutomatable: false,     icon: 'image',                 name: 'Insert Image',          under: ['formatting', 'Markup/Markdown'], batch: 'exclude', onclick: 'handleInsertImage()' },

  // ── Formatting › Designer Fonts ───────────────────────────────────────────
  { function: 'openFontPickerModal', isAutomatable: true,   icon: 'slab_serif',            name: 'Designer Fonts',        under: ['formatting', 'Fonts'], batch: 'once:font', onclick: 'openFontPickerModal()' },

  // ── Operations ───────────────────────────────────────────────────────────
  { function: 'findandreplace', isAutomatable: false,        icon: 'find_replace',          name: 'Find and Replace',      under: ['operations'], batch: 'app', onclick: 'findandreplace()' },
  { function: 'openWorkflowPanel', isAutomatable: false,     icon: 'link',                  name: 'Workflows',             under: ['operations'], batch: 'app', onclick: 'window.openWorkflowPanel && window.openWorkflowPanel()' },
  { function: 'handleCleanupText', isAutomatable: true,     icon: 'cleaning_services',     name: 'Cleanup Text',          under: ['operations'], batch: 'exclude', onclick: 'handleCleanupText()' },
  { function: 'handlePattern', isAutomatable: true,         icon: 'swap_horiz',            name: 'Pattern Replacement',   under: ['operations'], batch: 'exclude', onclick: 'handlePattern()' },
  { function: 'handleAdd', isAutomatable: true,             icon: 'add',                   name: 'Add Text',              under: ['operations'], batch: 'exclude', onclick: 'handleAdd()' },

  // ── Code ──────────────────────────────────────────────────────────────────
  { function: 'cipher', isAutomatable: true,                icon: 'key',                   name: 'Cipher',                under: ['code'], batch: 'once:cipher', onclick: 'cipher()' },
  { function: 'MD5', isAutomatable: true,                   icon: 'encrypted',             name: 'MD5 Hash',              under: ['code'], batch: 'file', onclick: 'MD5()' },
  { function: 'SHA256', isAutomatable: true,                icon: 'encrypted',             name: 'SHA256 Hash',           under: ['code'], batch: 'file', onclick: 'SHA256()' },
  { function: 'handleRemoveHtml', isAutomatable: true,      icon: 'html',                  name: 'Remove HTML',           under: ['code'], batch: 'file', onclick: 'handleRemoveHtml()' },
  { function: 'handleEscapeHtml', isAutomatable: true,      icon: 'html',                  name: 'Escape HTML',           under: ['code'], batch: 'file', onclick: 'handleEscapeHtml()' },
  { function: 'handleUnescapeHtml', isAutomatable: true,    icon: 'html',                  name: 'Unescape HTML',         under: ['code'], batch: 'file', onclick: 'handleUnescapeHtml()' },
  { function: 'handleTextToTable', isAutomatable: true,     icon: 'table',                 name: 'Text To HTML Table',    under: ['code'], batch: 'once:tabletext', onclick: 'handleTextToTable()' },
  { function: 'optimisecss', isAutomatable: true,           icon: 'css',                   name: 'Optimise CSS',          under: ['code'], batch: 'file', onclick: 'optimisecss()' },
  { function: 'minifycss', isAutomatable: true,             icon: 'css',                   name: 'Minify CSS',            under: ['code'], batch: 'file', onclick: 'minifycss()' },
  { function: 'optimisejs', isAutomatable: true,            icon: 'javascript',            name: 'Optimise JS',           under: ['code'], batch: 'file', onclick: 'optimisejs()' },
  { function: 'minifyjs', isAutomatable: true,              icon: 'javascript',            name: 'Minify JS',             under: ['code'], batch: 'file', onclick: 'minifyjs()' },
  { function: 'handleLatex', isAutomatable: false,           icon: 'data_object',           name: 'Handle Latex',          under: ['code'], batch: 'file', onclick: 'handleLatex()' },
  { function: 'openCsvexecFunctions', isAutomatable: false,  icon: 'table',                 name: 'CSVExec Functions',     under: ['code'], batch: 'exclude', onclick: 'openCsvexecFunctions()' },

  // ── Document ─────────────────────────────────────────────────────────────
  { function: 'openFetchModal', isAutomatable: true,        icon: 'data_object',           name: 'Fetch URL',             under: ['document'], batch: 'exclude', onclick: 'openFetchModal()' },
  { function: 'handleOpenFile', isAutomatable: false,        icon: 'folder_open',           name: 'Open File',             under: ['document'], batch: 'app', onclick: 'handleOpenFile()' },
  { function: 'debug', isAutomatable: false,                 icon: 'bug_report',            name: 'Debug',                 under: ['document'], batch: 'app', onclick: 'debug()' },
  { function: 'openVersionRecovery', isAutomatable: false,   icon: 'history',               name: 'Recover Versions',      under: ['document'], batch: 'app', onclick: 'openVersionRecovery()' },
  { function: 'forceSyncToCloud', isAutomatable: false,      icon: 'cloud_upload',          name: 'Force Sync to Cloud',   under: ['document'], batch: 'app', onclick: 'forceSyncToCloud()' },
{ function: 'foldAll', isAutomatable: false,                   icon: 'unfold_less',   name: 'Fold All',                    under: ['document'], onclick: 'foldAll()' },
{ function: 'unfoldAll', isAutomatable: false,                 icon: 'unfold_more',   name: 'Unfold All',                  under: ['document'], onclick: 'unfoldAll()' },
{ function: 'removeContentInsideFolds', isAutomatable: false,  icon: 'compress',      name: 'Remove Folded Contents',      under: ['document'], onclick: 'removeContentInsideFolds()' },

  // ── Transformer ──────────────────────────────────────────────────────────
  { function: 'openDocsCopier', isAutomatable: false,        icon: 'paste',                 name: 'Docscopier', under: ['transformer'], batch: 'exclude', onclick: 'openDocsCopier()' },

  // ── Markdown (Design mode) ────────────────────────────────────────────────
  // Block type
  { function: 'mdParagraph', isAutomatable: false, icon: 'text_fields',            name: 'Paragraph',          under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('p')" },
  { function: 'mdH1', isAutomatable: false,        icon: 'title',                  name: 'Heading 1',          under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('h1')" },
  { function: 'mdH2', isAutomatable: false,        icon: 'title',                  name: 'Heading 2',          under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('h2')" },
  { function: 'mdH3', isAutomatable: false,        icon: 'title',                  name: 'Heading 3',          under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('h3')" },
  { function: 'mdBullets', isAutomatable: false,   icon: 'format_list_bulleted',   name: 'Bullet List',        under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('ul')" },
  { function: 'mdNumbers', isAutomatable: false,   icon: 'format_list_numbered',   name: 'Numbered List',      under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('ol')" },
  { function: 'mdTasks', isAutomatable: false,     icon: 'format_list_bulleted',   name: 'Task List',          under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('task')" },
  { function: 'mdQuote', isAutomatable: false,     icon: 'format_indent_increase', name: 'Quote',              under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('quote')" },
  { function: 'mdCode', isAutomatable: false,      icon: 'code',                   name: 'Code Block',         under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('code')" },
  { function: 'mdMermaid', isAutomatable: false,   icon: 'hub',                    name: 'Mermaid Diagram',    under: ['markdown', 'Block type'], batch: 'exclude', onclick: "dexMdRun('mermaid')" },
  // Inline
  { function: 'mdBold', isAutomatable: false,      icon: 'format_bold',            name: 'Bold (toggle)',      under: ['markdown', 'Inline'],     batch: 'exclude', onclick: "dexMdRun('bold')" },
  { function: 'mdItalic', isAutomatable: false,    icon: 'format_italic',          name: 'Italic (toggle)',    under: ['markdown', 'Inline'],     batch: 'exclude', onclick: "dexMdRun('italic')" },
  { function: 'mdStrike', isAutomatable: false,    icon: 'format_underlined',      name: 'Strikethrough',      under: ['markdown', 'Inline'],     batch: 'exclude', onclick: "dexMdRun('strike')" },
  { function: 'mdInlineCode', isAutomatable: false,icon: 'code',                   name: 'Inline Code',        under: ['markdown', 'Inline'],     batch: 'exclude', onclick: "dexMdRun('icode')" },
  { function: 'mdLink', isAutomatable: false,      icon: 'link',                   name: 'Link…',              under: ['markdown', 'Inline'],     batch: 'exclude', onclick: "dexMdRun('link')" },
  { function: 'mdImage', isAutomatable: false,     icon: 'image',                  name: 'Image…',             under: ['markdown', 'Inline'],     batch: 'exclude', onclick: "dexMdRun('image')" },
  // Insert
  { function: 'mdTable', isAutomatable: false,     icon: 'table',                  name: 'Insert Table…',      under: ['markdown', 'Insert'],     batch: 'exclude', onclick: "dexMdRun('table')" },
  { function: 'mdDivider', isAutomatable: false,   icon: 'ttt_separator',          name: 'Insert Divider',     under: ['markdown', 'Insert'],     batch: 'exclude', onclick: "dexMdRun('hr')" },
  // Arrange
  { function: 'mdUp', isAutomatable: false,        icon: 'keyboard_double_arrow_up',   name: 'Move Block Up',   under: ['markdown', 'Arrange'],   batch: 'exclude', onclick: "dexMdRun('up')" },
  { function: 'mdDown', isAutomatable: false,      icon: 'keyboard_double_arrow_down', name: 'Move Block Down', under: ['markdown', 'Arrange'],   batch: 'exclude', onclick: "dexMdRun('down')" },
  { function: 'mdDup', isAutomatable: false,       icon: 'copy',                   name: 'Duplicate Block',    under: ['markdown', 'Arrange'],    batch: 'exclude', onclick: "dexMdRun('dup')" },
  { function: 'mdDel', isAutomatable: false,       icon: 'delete',                 name: 'Delete Block',       under: ['markdown', 'Arrange'],    batch: 'exclude', onclick: "dexMdRun('del')" },
  { function: 'mdSelBlock', isAutomatable: false,  icon: 'selectAll',              name: 'Select Block',       under: ['markdown', 'Arrange'],    batch: 'exclude', onclick: "dexMdRun('selblock')" },
  { function: 'mdIndent', isAutomatable: false,    icon: 'format_indent_increase', name: 'Indent List Item',   under: ['markdown', 'Arrange'],    batch: 'exclude', onclick: "dexMdRun('indent')" },
  { function: 'mdOutdent', isAutomatable: false,   icon: 'format_indent_decrease', name: 'Outdent List Item',  under: ['markdown', 'Arrange'],    batch: 'exclude', onclick: "dexMdRun('outdent')" },

]);
