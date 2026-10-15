/**
 * DexLabs Docs Content
 * ─────────────────────────────────────────────────────────────────────────────
 * Injects docs overlay body content dynamically so index.html stays clean.
 * Called once on DOMContentLoaded (or after DOM is ready).
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  const DOCS_BODY_CONTENT = /* html */`

<h2>What this is</h2>
<p>DexLabs Note App is a fast, keyboard-and-touch-friendly text editor and file manager that runs
entirely in your browser. There&rsquo;s no server backend beyond optional Google Drive sync &mdash;
your notes live in this browser&rsquo;s local storage, organized into folders, and sync to your
own Drive account if you sign in.</p>

<h2>Getting started</h2>
<p>From the homepage, tap <strong>Note App</strong> to open the file manager. If this is your first
visit, tap the <strong>+</strong> button to create your first file or folder. Tapping a file opens
it in the editor.</p>

<h2>The file manager</h2>
<p>The file manager (<code>/filemanager</code>) is the app&rsquo;s entry point &mdash; every note
lives in a folder tree you can search, sort, and reorganize. Its left sidebar holds app-level
tools: Settings, Debug, Sync to Cloud, and Asteroid Belt (a visual map of how your notes link to
each other).</p>
<p>Tap <strong>Select</strong> to enter select mode: pick multiple files and Move, Copy, Download,
Delete, or Batch apply a function to all of them at once &mdash; &ldquo;zap mode.&rdquo; Batch
apply only ever lists functions that are safe to run across many files unattended; anything that
needs per-file input (like a modal asking for a URL) is left out on purpose rather than crashing
mid-run.</p>

<h2>Three modes, one note</h2>
<p>Every open note has a URL shape of <code>/note/:id/:mode</code>. The mode segment is real and
bookmarkable:</p>
<ul>
<li><strong>Base</strong> &mdash; the plain text/code editor, with syntax highlighting based on
    the file&rsquo;s extension.</li>
<li><strong>Diffusion</strong> &mdash; a side-by-side Raw/Morph comparison and diff tool, useful
    for merging or reviewing two versions of similar text. Turn it on from Settings &rarr;
    Exclusive.</li>
<li><strong>Mermaid</strong> &mdash; a Mermaid.js diagram editor with a live preview, reachable
    the same way. Only one exclusive mode can be active per note at a time.</li>
</ul>

<h2>Raw &amp; exec views</h2>
<p>Every <code>.csv</code> and <code>.md</code> file in the sidebar has a small <strong>raw | exec</strong>
switch just left of its edit button. <strong>Raw</strong> is the normal text editor. <strong>Exec</strong>
runs the file: a <code>.csv</code> opens as a spreadsheet where cells starting with <code>=</code> are
formulas, and a <code>.md</code> opens as a rendered document with tables, task lists you can tick,
and <code>mermaid</code> code fences drawn as diagrams. Each file remembers its own choice, the file
itself is never altered by switching, and the exclusive modes below take over the editor while they&rsquo;re on.</p>

<h2>Selecting and editing text</h2>
<p>Long-press to select a word on any text surface &mdash; the base editor, a diff view, or the
Mermaid code pane. Pause for a moment after selecting and a small menu appears near your selection
with the actions that make sense for what you&rsquo;re looking at (Copy/Cut/Paste everywhere;
Copy Raw/Copy Morph in Diffusion; Save selection/Swap line in a diff view). This is separate from
the D-pad, which is its own floating cursor-and-menu tool for the base editor.</p>

<h2>Sidebar functions &amp; Grand Functions</h2>
<p>Open a note and tap the second sidebar icon for the quick-action panel &mdash; font size,
clipboard actions, pinned shortcuts, and your categorized function collection. Tap
<strong>Grand Functions</strong> at the bottom to browse the full registry of 2000+ functions,
organized by category with cascading dropdowns and live search. Pin any function to the sidebar
or add it to your personal collection (User DB) so it appears under <em>Categories</em>.</p>

<h2>Chains</h2>
<p>A &ldquo;chain&rdquo; is a saved sequence of find/replace steps (and certain functions) you can
re-run on any note, or across many notes at once via batch apply. Build one from
Operations &rarr; Chains.</p>

<h2>Asteroid Belt</h2>
<p>Link two notes by writing <code>{{note title}}</code> in either one&rsquo;s content. Open
Asteroid Belt from the file manager sidebar to see every note as a point in a force-directed
graph, connected by the links between them &mdash; tap any point to jump straight to that note.</p>

<h2>Settings</h2>
<p>Light/dark theme, editor syntax theme, line numbers, word wrap, and the two exclusive modes
all live in Settings, reachable from the file manager sidebar or from inside any note.</p>

<h2>Staying in sync</h2>
<p>Sign in with Google from the homepage to back up notes to your Drive&rsquo;s app-data folder
and pick up where you left off on another device. Everything still works fully offline without an
account &mdash; sync is optional.</p>

  `;

  function injectDocsContent() {
    const docsBody = document.querySelector('.docs-body');
    if (!docsBody) return;
    // Only inject if the docs body is currently empty (no pre-rendered content)
    if (!docsBody.children.length) {
      docsBody.innerHTML = DOCS_BODY_CONTENT;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectDocsContent);
  } else {
    injectDocsContent();
  }
})();
