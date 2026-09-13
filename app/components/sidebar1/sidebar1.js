/* ============================================================
   SIDEBAR 1  (note-mode slide-in drawer)
   ============================================================ */
.sidebar-header {
  padding: 15px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 20px auto 0 auto;
  width: fit-content;
  min-width: 350px;
}
.sidebar-actions { display: flex; gap: 10px; background: var(--primary); }
.sidebar {
  width: 100vw;
  background: var(--primary);
  position: fixed;
  top: calc(10px + var(--topbar-height) + 10px);
  bottom: 0;
  transform: translateX(-100%);
  transition: transform var(--transition-speed);
  will-change: transform;
  z-index: 10;
  overflow-y: scroll;
  display: block;
}
body.topbar-closed .sidebar { top: 10px; }
.sidebar.open { transform: translateX(0); }

.action-button {
  background: var(--matte); border: none; color: var(--color);
  cursor: pointer; width: 36px; height: 36px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.note-item {
  padding: 15px 20px; cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  background: var(--matte); margin: 10px auto;
  border-radius: 50px; width: fit-content; min-width: 350px;
}
.note-item:hover { background-color: color-mix(in srgb, var(--c-black) 05%, transparent); }
.note-item.selected { background-color: color-mix(in srgb, var(--c-black) 10%, transparent); }

@media (max-width: 600px) {
  .sidebar { overflow-x: hidden; }
  .note-item { width: 100%; min-width: 200px; padding: 18px 24px; }
  .note-list { display: flex; overflow-x: auto; padding: 10px; flex-wrap: wrap; }
  .action-button { width: 40px; height: 40px; }
}

/* ── dex tree (file browser) ── */
#sidebar1 { display: flex; flex-direction: column; }
#sidebar1 .dex-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--c-white) 06%, transparent);
}
#sidebar1 .dex-crumbs {
  display: flex; align-items: center; gap: 3px;
  flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; scrollbar-width: none;
}
#sidebar1 .dex-crumbs::-webkit-scrollbar { display: none; }
#sidebar1 .dex-crumb {
  font-size: 14px; color: var(--c-text-faint);
  cursor: pointer; padding: 2px 5px; border-radius: 6px;
}
#sidebar1 .dex-crumb:last-child { color: var(--c-white); }
#sidebar1 .dex-crumb:hover { color: var(--c-white); background: color-mix(in srgb, var(--c-white) 05%, transparent); }
#sidebar1 .dex-sep { color: var(--c-text-faint); font-size: 12px; }
#sidebar1 .dex-tools { display: flex; gap: 6px; flex-shrink: 0; }
#sidebar1 .dex-tool {
  width: 38px; height: 38px; padding: var(--btn-padding); box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px; background: var(--c-panel-2); border: 1px solid var(--c-panel-3);
  color: var(--c-text-dim); cursor: pointer;
  transition: background .15s, border-color .15s, color .15s, transform .15s;
}
#sidebar1 .dex-tool:hover { color: var(--c-white); }
#sidebar1 .dex-tool.danger { color: var(--c-danger); border-color: color-mix(in srgb, var(--c-danger) 28%, transparent); }
#sidebar1 .dex-tool.accent { color: var(--c-accent); border-color: color-mix(in srgb, var(--c-accent) 30%, transparent); }
#sidebar1 .dex-tool svg { width: var(--icon-size); height: var(--icon-size); }

.dex-tree { flex: 1; overflow: auto; padding: 8px 6px; }
.dex-item { border-radius: 8px; }
.dex-row {
  display: flex; align-items: center; gap: 9px; padding: 9px 10px;
  border-radius: 8px; cursor: pointer; transition: background .15s ease;
}
.dex-row:hover         { background: color-mix(in srgb, var(--c-white) 04%, transparent); }
.dex-row.sel           { background: color-mix(in srgb, var(--c-accent) 12%, transparent); }
.dex-row.dex-current   { background: color-mix(in srgb, var(--c-blue) 12%, transparent); }
.dex-row.dex-current .dex-ic { color: var(--c-blue); }
.dex-row.dex-pick-active {
  background: color-mix(in srgb, var(--c-green) 14%, transparent);
  outline: 1px solid color-mix(in srgb, var(--c-green) 40%, transparent);
}
.dex-row.dex-pick-active .dex-ic { color: var(--c-green); }
.dex-chev.onpath { color: var(--c-blue); }
.dex-ic { width: var(--icon-size); height: var(--icon-size); flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: var(--c-text-dim); }
.dex-ic svg { width: 100%; height: 100%; }
.dex-ic-folder { color: var(--c-folder-icon); }
.dex-name { flex: 1; font-size: 13.5px; color: var(--c-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dex-name.folder { color: var(--c-white); font-weight: 500; }
.dex-badge { font-size: 10.5px; color: var(--c-text-faint); margin-left: 6px; white-space: nowrap; }
.dex-add { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; color: var(--c-text-dim); border-radius: 6px; flex-shrink: 0; }
.dex-add:hover { background: color-mix(in srgb, var(--c-white) 07%, transparent); }
.dex-add svg { width: 15px; height: 15px; }
.dex-check { width: 19px; height: 19px; border-radius: 5px; border: 1.5px solid var(--c-border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--c-black); }
.dex-check svg { width: 13px; height: 13px; }
.dex-check.on { background: var(--c-accent); border-color: var(--c-accent); }
.dex-empty { padding: 16px 12px; text-align: center; color: var(--c-text-faint); font-size: 12.5px; }
#sidebar1 .dex-subhead {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--c-white) 06%, transparent);
}
#sidebar1 .dex-search {
  flex: 1; min-width: 0; background: var(--c-panel-2); border: 1px solid var(--c-panel-3);
  color: var(--c-white); border-radius: 8px; padding: var(--btn-padding);
  font-family: inherit; font-size: 13px; outline: none;
}
#sidebar1 .dex-search::placeholder { color: var(--c-text-faint); }
#sidebar1 .dex-search:focus { border-color: var(--c-accent); }
#sidebar1 .dex-sort {
  width: 38px; height: 38px; flex-shrink: 0; padding: var(--btn-padding); box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px; background: var(--c-panel-2); border: 1px solid var(--c-panel-3);
  color: var(--c-text-dim); cursor: pointer;
}
#sidebar1 .dex-sort:hover { color: var(--c-white); }
#sidebar1 .dex-sort svg { width: var(--icon-size); height: var(--icon-size); }
.dex-sort-menu {
  position: fixed; z-index: 100003; background: var(--c-panel);
  border: 1px solid color-mix(in srgb, var(--c-white) 8%, transparent);
  border-radius: 10px; padding: 6px; min-width: 210px;
}
.dex-sort-item { padding: 9px 12px; border-radius: 7px; font-size: 13px; color: var(--c-text-dim); cursor: pointer; white-space: nowrap; }
.dex-sort-item:hover { background: color-mix(in srgb, var(--c-white) 06%, transparent); }
.dex-sort-item.on { color: var(--c-blue); }
.dex-sort-sep { height: 1px; background: color-mix(in srgb, var(--c-white) 08%, transparent); margin: 6px 4px; }
.dex-sort-toggle { display: flex; align-items: center; gap: 9px; }
.dex-sort-toggle .dex-mini-check {
  width: 19px; height: 19px; border-radius: 5px; border: 1.5px solid var(--c-border);
  background: transparent; display: inline-flex; align-items: center; justify-content: center;
  color: var(--c-black); flex-shrink: 0;
}
.dex-sort-toggle .dex-mini-check svg { width: 13px; height: 13px; }
.dex-sort-toggle.on .dex-mini-check { background: var(--c-accent); border-color: var(--c-accent); }
.dex-chev { width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: var(--c-text-faint); transition: transform .2s ease; flex-shrink: 0; }
.dex-chev.open { transform: rotate(90deg); }
.dex-chev svg { width: 14px; height: 14px; }
.dex-children { position: relative; padding-left: 18px; }
.dex-children::before {
  content: ''; position: absolute; left: 13px; top: 0; bottom: 8px; width: 1px;
  background: linear-gradient(to bottom, color-mix(in srgb, var(--c-white) 32%, transparent), color-mix(in srgb, var(--c-white) 05%, transparent));
}
.dex-kind-row { display: flex; gap: 8px; margin-top: 4px; }
.dex-delkey { font-size: 24px; letter-spacing: 6px; text-align: center; color: var(--c-danger); font-weight: 600; margin: 12px 0; font-family: 'Source Code Pro', monospace; }


/* ============================================================
   FILEMANAGER ROUTE — merged left bar
   Shape: RNW vertical bar — 64 px wide, full height inset 10 px,
   border-radius: 19 px. Topbar is hidden; this is the sole
   navigation surface for the filemanager route.
   ============================================================ */

/* ── Left-edge hotspot: reopens FM nav when closed ── */
.fm-edge-hotspot {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 7px;
  background: transparent;
  border: 0;
  border-radius: 0 999px 999px 0;
  cursor: pointer;
  z-index: 12;
  pointer-events: none;
  opacity: 0;
  transition:
    width  0.22s cubic-bezier(0.4,0,0.2,1),
    height 0.22s cubic-bezier(0.4,0,0.2,1),
    background 0.22s ease,
    opacity 0.18s ease;
}
body.mode-filemanager.fm-nav-closed .fm-edge-hotspot {
  pointer-events: auto;
  opacity: 0.38;
}
.fm-edge-hotspot:hover,
.fm-edge-hotspot:focus-visible {
  width: 18px;
  height: 58px;
  background: color-mix(in srgb, var(--c-white) 10%, transparent);
  opacity: 1;
}
@media (hover: none), (pointer: coarse) {
  body.mode-filemanager.fm-nav-closed .fm-edge-hotspot {
    width: 34px;
    height: 72px;
    background: color-mix(in srgb, var(--c-white) 06%, transparent);
    opacity: 0.72;
  }
}

/* ── FM merged nav bar ── */
.filemanager-app-sidebar {
  display: none;
  position: fixed;
  left: 10px;
  top: 10px;
  bottom: 10px;
  width: 64px;
  flex-direction: column;
  align-items: center;
  padding: 5px;
  background: var(--c-panel);
  border: 1px solid color-mix(in srgb, var(--c-white) 8%, transparent);
  border-radius: 19px;
  z-index: 11;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  transition:
    width  0.35s cubic-bezier(0.4,0,0.2,1),
    border-radius 0.35s cubic-bezier(0.4,0,0.2,1);
}
.filemanager-app-sidebar::-webkit-scrollbar { display: none; }
body.mode-filemanager .filemanager-app-sidebar { display: flex; }
body.mode-filemanager.fm-nav-closed .filemanager-app-sidebar { display: none; }

/* ── FM expand control (top, order 1 per RNW vertical) ── */
.fm-expand {
  flex: 0 0 42px;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 12px;       /* template: .bar-expand border-radius */
  background: transparent;
  color: var(--c-text-faint);
  cursor: pointer;
  transition: background .16s ease, color .16s ease, transform .16s ease;
  margin-bottom: 2px;
}
.fm-expand:hover  { background: color-mix(in srgb, var(--c-white) 06%, transparent); color: var(--c-white); }
.fm-expand:active { transform: scale(0.9); }
.fm-expand:focus-visible { outline: 2px solid var(--c-accent); outline-offset: -4px; }

/* ── FM nav items: icon-only, RNW vertical bar icon-item dimensions ── */
.fm-app-item {
  flex: 0 0 42px;
  width: 52px;            /* template: .bar-v .icon-item width = 52px */
  height: 42px;           /* template: .bar-v .icon-item height = 42px */
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 10px;    /* template: .icon-item border-radius */
  background: transparent;
  color: var(--c-text-faint);
  font-family: inherit;
  cursor: pointer;
  transition: color 0.16s ease, transform 0.16s ease, background 0.16s ease;
}
.fm-app-item:hover  { background: color-mix(in srgb, var(--c-white) 06%, transparent); color: var(--c-white); }
.fm-app-item:active { transform: scale(0.88); }
.fm-app-item:focus-visible { outline: 2px solid var(--c-accent); outline-offset: -4px; }
.fm-app-item span { display: none; } /* icon-only bar */

/* Active indicator — right side dot (toward content), per template .bar-left */
.fm-app-item.active { color: var(--c-white); }
.fm-app-item.active::after {
  content: "";
  position: absolute;
  right: 5px; top: 50%;
  width: 2px; height: 15px;
  transform: translateY(-50%);
  border-radius: 999px;
  background: var(--c-white);
}

/* Close: pinned to bottom */
.fm-nav-close { margin-top: auto; }

/* ── Thin divider between sections ── */
.fm-divider {
  width: 26px; height: 1px;
  background: color-mix(in srgb, var(--c-white) 08%, transparent);
  border-radius: 999px;
  margin: 4px 0;
  flex-shrink: 0;
}

/* ── Suppress topbar + editor content in FM route ── */
body.mode-filemanager .topbar              { display: none !important; }
body.mode-filemanager .topbar-edge-hotspot { display: none !important; }
body.mode-filemanager .note-container      { display: none !important; }
body.mode-filemanager #sidebar2            { display: none !important; }
body.mode-filemanager .voldemort-container { display: none !important; }

/* ── Dock file browser to right of 64px nav bar ──
   left = 10px (app pad) + 64px (bar) + 10px (gap) = 84px */
body.mode-filemanager #sidebar1 {
  position: fixed;
  left: 84px;
  right: 0;
  top: 0;
  bottom: 0;
  width: auto;
  transform: none;
  z-index: 10;
}
body.mode-filemanager .note-app-container { padding-top: 0; }

/* Collapse file browser on demand */
body.mode-filemanager.fm-sidebar-collapsed #sidebar1 { display: none; }
body.mode-filemanager.fm-nav-closed #sidebar1 { left: 0; }

/* Legacy per-button topbar hides (now redundant but kept) */
body.mode-filemanager #topbar #undoBtn,
body.mode-filemanager #topbar #redoBtn,
body.mode-filemanager #topbar .topbar-button[onclick*="toggleFullscreen"],
body.mode-filemanager #topbar #voldemortToggle,
body.mode-filemanager #topbar #secondary-sidebar-button { display: none; }

/* ── Responsive ── */
@media (max-width: 640px) {
  .filemanager-app-sidebar { left: 7px; top: 7px; bottom: 7px; }
  body.mode-filemanager #sidebar1 { left: 81px; }
}


/* ============================================================
   BAR EDITOR — item-visibility panel (shared by FM bar + topbar)
   Shape: RNW navigation-expanded — border-radius: 19px, dark theme.
   ============================================================ */
.bar-editor {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 100001;
  align-items: center;
  justify-content: center;
}
.bar-editor.open { display: flex; }

.bar-editor-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--c-black) 72%, transparent);
  backdrop-filter: blur(3px);
}

.bar-editor-panel {
  position: relative;
  z-index: 1;
  width: min(380px, calc(100% - 28px));
  max-height: min(600px, calc(100dvh - 60px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--c-white) 10%, transparent);
  border-radius: 19px;
  background: var(--c-panel);
  box-shadow: 0 24px 60px rgba(0,0,0,.5);
  opacity: 0;
  transform: scale(.96);
  transition: opacity .22s ease, transform .22s cubic-bezier(.4,0,.2,1);
}
.bar-editor.open .bar-editor-panel { opacity: 1; transform: scale(1); }

.bar-editor-head {
  flex: 0 0 56px;
  display: flex;
  align-items: center;
  padding: 0 8px 0 16px;
  gap: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--c-white) 06%, transparent);
}
.bar-editor-kicker {
  font-size: 8.5px;
  font-weight: 700;
  letter-spacing: .14em;
  color: var(--c-text-faint);
  margin-bottom: 3px;
}
.bar-editor-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-white);
}
.bar-editor-head-text { flex: 1; min-width: 0; }

.bar-editor-close {
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--c-text-faint);
  cursor: pointer;
  transition: background .16s ease, color .16s ease;
}
.bar-editor-close:hover { background: color-mix(in srgb, var(--c-white) 06%, transparent); color: var(--c-white); }

.bar-editor-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--c-white) 12%, transparent) transparent;
}

.bar-editor-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 10px;
  transition: background .14s ease;
}
.bar-editor-item:hover { background: color-mix(in srgb, var(--c-white) 04%, transparent); }

.bar-editor-item-icon {
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  color: var(--c-text-faint);
  transition: color .14s ease;
}
.bar-editor-item-label {
  flex: 1;
  font-size: 13.5px;
  color: var(--c-text-dim);
  transition: color .14s ease;
}
.bar-editor-item.is-hidden .bar-editor-item-icon,
.bar-editor-item.is-hidden .bar-editor-item-label {
  color: color-mix(in srgb, var(--c-white) 28%, transparent);
}

.bar-editor-eye {
  flex: 0 0 34px;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  transition: background .16s ease, color .16s ease;
}
.bar-editor-eye:hover { background: color-mix(in srgb, var(--c-white) 06%, transparent); }
.bar-editor-eye.is-on  { color: var(--c-white); }
.bar-editor-eye.is-off { color: color-mix(in srgb, var(--c-white) 28%, transparent); }

@media (max-width: 600px) {
  .bar-editor-panel { border-radius: 17px; }
}
