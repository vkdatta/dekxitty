/**
 * Dekxitty - expanded navigation ("department browser").
 * Lets the user show/hide/reorder/nest the items of the top bar and the file
 * manager bar. State is persisted in localStorage (dex-dept-*).
 *
 * Non-ASCII characters are written as \u escapes on purpose: this code used to
 * be inline in index.html, where Blogger turns a literal em dash into the text
 * "&#8212;" inside <script> (script text is never entity-decoded).
 */

/* ================================================================
   NAVIGATION EXPANDED - department browser (RNW template port)
   ================================================================ */

var DEX_DEPTS = {
  topbar: [
    { id: "tb-tools", name: "Editor Tools", icon: "edit", items: [
      { id: "undoBtn",                  icon: "undo",              label: "Undo",        hidden: false },
      { id: "redoBtn",                  icon: "redo",              label: "Redo",        hidden: false },
      { id: "topbarHome",               icon: "home_app_logo",     label: "Home",        hidden: false },
      { id: "topbarFullscreen",         icon: "fullscreen",        label: "Full Screen", hidden: false },
      { id: "voldemortToggle",          icon: "import_contacts",   label: "Tom Riddle",  hidden: false },
      { id: "sidebar1Toggle",           icon: "view_object_track", label: "Sidebar",     hidden: false },
      { id: "secondary-sidebar-button", icon: "view_cozy",         label: "Sidebar 2",   hidden: false }
    ]}
  ],
  fm: [
    { id: "fm-nav", name: "Navigation", icon: "home_app_logo", items: [
      { id: "fmHome",           icon: "home_app_logo",     label: "Home",           hidden: false },
      { id: "fmSidebar1Toggle", icon: "view_object_track", label: "Toggle Browser", hidden: false }
    ]},
    { id: "fm-tools", name: "Tools", icon: "tune", items: [
      { id: "fmSettings", icon: "tune",         label: "Settings",      hidden: false },
      { id: "fmDebug",    icon: "bug_report",   label: "Debug",         hidden: false },
      { id: "fmSync",     icon: "cloud_upload", label: "Sync to Cloud", hidden: false },
      { id: "fmAsteroid", icon: "hub",          label: "Asteroid Belt", hidden: false }
    ]}
  ]
};

var DEX_BAR_SEL = { topbar: ["tb-tools"], fm: ["fm-nav","fm-tools"] };
var currentExpandedBarId = null;
var expandedNestedStack  = [];
var builderMode          = "section";
var builderTargetItems   = null;

/* -- Apply state to DOM -----------------------------------------
   FIX: use insertBefore to MOVE nodes (keeps them in DOM so
   getElementById keeps working). Never removeChild on items.    */
function dexApplyBarState(barId) {
  var depts = DEX_DEPTS[barId] || [];
  var sel   = DEX_BAR_SEL[barId] || [];

  if (barId === "topbar") {
    var container = document.querySelector(".topbar-section");
    if (!container) return;
    depts.forEach(function(dept) {
      var on = sel.indexOf(dept.id) !== -1;
      dept.items.forEach(function(item) {
        var el = document.getElementById(item.id);
        if (!el) return;
        el.style.display = (!on || item.hidden) ? "none" : "";
        container.appendChild(el); /* moves to end = reorders */
      });
    });
  } else {
    var sidebar  = document.getElementById("fileManagerSidebar");
    if (!sidebar) return;
    var navClose = sidebar.querySelector(".fm-nav-close");

    /* remove only the dividers - items stay in DOM (moved, not deleted) */
    var dividers = sidebar.querySelectorAll(".fm-divider");
    for (var di = 0; di < dividers.length; di++) { sidebar.removeChild(dividers[di]); }

    /* re-insert items + fresh dividers in data order */
    depts.forEach(function(dept) {
      var on = sel.indexOf(dept.id) !== -1;
      if (!on) {
        dept.items.forEach(function(item) {
          var el = document.getElementById(item.id);
          if (el) el.style.display = "none";
        });
        return;
      }
      var div = document.createElement("div");
      div.className = "fm-divider"; div.setAttribute("aria-hidden","true");
      sidebar.insertBefore(div, navClose);
      dept.items.forEach(function(item) {
        var el = document.getElementById(item.id);
        if (!el) return;
        el.style.display = item.hidden ? "none" : "";
        sidebar.insertBefore(el, navClose); /* MOVE, not copy */
      });
    });
  }

  try {
    localStorage.setItem("dex-dept-state-" + barId, JSON.stringify(DEX_DEPTS[barId]));
    localStorage.setItem("dex-dept-sel-"   + barId, JSON.stringify(DEX_BAR_SEL[barId]));
  } catch(e) {}
}

/* -- Restore from localStorage (runs as IIFE - bar elements are
   above the script in DOM so getElementById works immediately)  */
(function dexRestoreState() {
  ["topbar","fm"].forEach(function(barId) {
    try {
      var rawDepts = localStorage.getItem("dex-dept-state-" + barId);
      var rawSel   = localStorage.getItem("dex-dept-sel-"   + barId);
      if (rawDepts) {
        var saved = JSON.parse(rawDepts);
        DEX_DEPTS[barId].forEach(function(dept) {
          var sd = null;
          for (var i = 0; i < saved.length; i++) { if (saved[i].id === dept.id) { sd = saved[i]; break; } }
          if (!sd) return;
          dept.items.forEach(function(item) {
            if (!sd.items) return;
            for (var j = 0; j < sd.items.length; j++) {
              if (sd.items[j].id === item.id) { item.hidden = sd.items[j].hidden; break; }
            }
          });
        });
      }
      if (rawSel) DEX_BAR_SEL[barId] = JSON.parse(rawSel);
    } catch(e) {}
    dexApplyBarState(barId);
  });
})();

/* -- Open / Close ------------------------------------------------ */
function openExpandedNavigation(barId) {
  currentExpandedBarId = barId;
  expandedNestedStack  = [];
  buildExpandedPanel();
  var titleEl = document.getElementById("expandedNavigationTitle");
  if (titleEl) titleEl.textContent = (barId === "fm" ? "File Manager" : "Top") + " Bar \u2014 Navigation";
  var panel = document.getElementById("navigationExpanded");
  if (!panel) return;
  panel.style.display = "flex";
  requestAnimationFrame(function() {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden","false");
    var closeBtn = document.getElementById("expandedClose");
    if (closeBtn) closeBtn.focus();
  });
}

function closeExpandedNavigation() {
  dexCloseExpandedRouteMap();
  dexCloseBuilder();
  dexCloseExistingPicker();
  var panel = document.getElementById("navigationExpanded");
  if (panel) {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden","true");
    setTimeout(function() { if (!panel.classList.contains("open")) panel.style.display = ""; }, 280);
  }
  if (currentExpandedBarId) {
    dexApplyBarState(currentExpandedBarId);
    currentExpandedBarId = null;
    expandedNestedStack  = [];
  }
}

/* -- Helpers ----------------------------------------------------- */
function dexGetCurrentItems() {
  if (!expandedNestedStack.length) return DEX_DEPTS[currentExpandedBarId] || [];
  return expandedNestedStack[expandedNestedStack.length-1].items || [];
}
function dexNodeVisible(item, depth) {
  if (depth === 0) return DEX_BAR_SEL[currentExpandedBarId].indexOf(item.id) !== -1;
  return !item.hidden;
}
function dexSetNodeVisible(item, depth, visible) {
  if (depth === 0) {
    var ids = DEX_BAR_SEL[currentExpandedBarId], idx = ids.indexOf(item.id);
    if (visible && idx === -1) ids.push(item.id);
    if (!visible && idx !== -1) ids.splice(idx,1);
  } else { item.hidden = !visible; }
}

/* -- Route map --------------------------------------------------- */
function dexCloseExpandedRouteMap() {
  var m = document.getElementById("expandedRouteMap"), b = document.getElementById("expandedRouteMapBackdrop");
  if (m) m.classList.remove("open");
  if (b) { b.classList.remove("open"); b.setAttribute("aria-hidden","true"); }
}
function dexOpenExpandedRouteMap() {
  var map = document.getElementById("expandedRouteMap"),
      bd  = document.getElementById("expandedRouteMapBackdrop"),
      lst = document.getElementById("expandedRouteMapList");
  if (!map || !bd || !lst) return;
  lst.innerHTML = "";
  var entries = [{ label:"root", depth:0, stack:[] }];
  expandedNestedStack.forEach(function(lv,i) {
    entries.push({ label:lv.label, depth:i+1, stack:expandedNestedStack.slice(0,i+1) });
  });
  function walkDesc(items, baseStack) {
    (items||[]).forEach(function(item) {
      var lbl = item.label||item.name||"Untitled";
      var children = Array.isArray(item.children) ? item.children : [];
      var ns = baseStack.concat([{key:item.id||lbl,label:lbl,items:children}]);
      entries.push({label:lbl,depth:ns.length,stack:ns});
      if (children.length) walkDesc(children,ns);
    });
  }
  walkDesc(dexGetCurrentItems(), expandedNestedStack.map(function(l){return{key:l.key,label:l.label,items:l.items||[]};}));
  var seen = {};
  entries.forEach(function(level) {
    var k = level.stack.map(function(l){return l.key;}).join("\x1f")||"root";
    if (seen[k]) return; seen[k]=true;
    var row = document.createElement("button");
    row.type="button"; row.className="expanded-route-map-row"+(level.depth===expandedNestedStack.length?" current":"");
    row.setAttribute("role","menuitem");
    var badge=document.createElement("span"); badge.className="expanded-route-map-level"; badge.textContent=String(level.depth).padStart(2,"0"); badge.setAttribute("aria-hidden","true");
    var lbl=document.createElement("span"); lbl.className="expanded-route-map-label"; lbl.textContent=level.label;
    row.append(badge,lbl);
    row.addEventListener("click",function(){
      var was=expandedNestedStack.length;
      expandedNestedStack=level.stack.map(function(s){return{key:s.key,label:s.label,items:s.items||[]};});
      dexCloseExpandedRouteMap();
      dexBuildExpandedDrill(true,level.depth>was?"forward":"back");
    });
    lst.appendChild(row);
  });
  map.classList.add("open"); bd.classList.add("open"); bd.setAttribute("aria-hidden","false");
}

/* -- Breadcrumb -------------------------------------------------- */
function dexBuildExpandedBreadcrumb() {
  var viewport = document.getElementById("expandedDrillViewport");
  if (!viewport) return;
  var old = document.getElementById("expandedBreadcrumb"); if (old) old.remove();
  var route = document.createElement("div"); route.id="expandedBreadcrumb"; route.className="expanded-breadcrumb"; route.setAttribute("aria-label","Navigation route");
  var prefix=document.createElement("span"); prefix.className="expanded-route-prefix"; prefix.textContent="$ route:"; route.appendChild(prefix);
  function addCrumb(label,index,current) {
    var btn=document.createElement("button"); btn.type="button"; btn.className="expanded-crumb"+(current?" current":""); btn.textContent=label;
    btn.addEventListener("click",function(){
      if (index===-1) expandedNestedStack=[];
      else if (index<expandedNestedStack.length-1) expandedNestedStack=expandedNestedStack.slice(0,index+1);
      else return;
      dexCloseExpandedRouteMap(); dexBuildExpandedDrill(true,"back");
    });
    route.appendChild(btn);
  }
  addCrumb("root",-1,expandedNestedStack.length===0);
  if (expandedNestedStack.length<=4) {
    expandedNestedStack.forEach(function(lv,i){
      var sep=document.createElement("span"); sep.className="expanded-crumb-sep"; sep.textContent="/"; route.appendChild(sep);
      addCrumb(lv.label,i,i===expandedNestedStack.length-1);
    });
  } else {
    var sep=document.createElement("span"); sep.className="expanded-crumb-sep"; sep.textContent="/"; route.appendChild(sep);
    var ell=document.createElement("button"); ell.type="button"; ell.className="expanded-route-ellipsis"; ell.textContent="..."; ell.setAttribute("aria-label","Show full route"); ell.addEventListener("click",dexOpenExpandedRouteMap); route.appendChild(ell);
    var tail=Math.max(0,expandedNestedStack.length-2);
    for (var ti=tail;ti<expandedNestedStack.length;ti++) {
      var s2=document.createElement("span"); s2.className="expanded-crumb-sep"; s2.textContent="/"; route.appendChild(s2);
      addCrumb(expandedNestedStack[ti].label,ti,ti===expandedNestedStack.length-1);
    }
  }
  if (viewport.parentElement) viewport.parentElement.insertBefore(route,viewport);
}

/* -- Drill-down pages -------------------------------------------- */
function dexBuildExpandedDrill(animate,direction) {
  animate=animate||false; direction=direction||"forward";
  var track=document.getElementById("expandedDrillTrack"), viewport=document.getElementById("expandedDrillViewport");
  if (!track||!viewport) return;
  var prevDepth=Number(track.dataset.depth||0), targetDepth=expandedNestedStack.length;
  var pages=[DEX_DEPTS[currentExpandedBarId]||[]];
  expandedNestedStack.forEach(function(lv){pages.push(lv.items||[]);});

  /* toolbar */
  var drill=document.getElementById("expandedDrill"), toolbar=document.getElementById("expandedDrillToolbar");
  if (!toolbar&&drill) { toolbar=document.createElement("div"); toolbar.id="expandedDrillToolbar"; toolbar.className="expanded-drill-toolbar"; drill.insertBefore(toolbar,viewport); }
  if (toolbar) {
    if (targetDepth===0) {
      toolbar.innerHTML='<button type="button" class="expanded-drill-tool" id="expandedNewMenuTool"><delluna-icon name="add"></delluna-icon><span>New section</span></button>';
      var nm=toolbar.querySelector("#expandedNewMenuTool"); if (nm) nm.addEventListener("click",function(){dexOpenBuilder("menu");});
    } else {
      toolbar.innerHTML='<button type="button" class="expanded-drill-tool"><delluna-icon name="create_new_folder"></delluna-icon><span>New group</span></button><button type="button" class="expanded-drill-tool" id="expandedAddExistingTool"><delluna-icon name="library_books"></delluna-icon><span>Add existing</span></button>';
      var ns=toolbar.querySelector(".expanded-drill-tool"); if (ns) ns.addEventListener("click",function(){dexOpenBuilder("section");});
      var ae=toolbar.querySelector("#expandedAddExistingTool"); if (ae) ae.addEventListener("click",dexOpenExistingPicker);
    }
  }

  track.innerHTML="";
  pages.forEach(function(items,pageIndex) {
    var page=document.createElement("div"); page.className="expanded-drill-page";
    var dragIndex=null;
    items.forEach(function(item,itemIndex) {
      var hasChildren=Array.isArray(item.children)&&item.children.length>0;
      var canMoveIn=pageIndex===0||hasChildren||item.moveIn===true;
      var visible=dexNodeVisible(item,pageIndex);
      var isDeletable=item.customMenu||item.customSection||item.shortcut;
      var row=document.createElement("div");
      row.className="expanded-drill-item"+(visible?"":" is-hidden"); row.draggable=true;
      row.innerHTML='<delluna-icon name="drag_indicator" class="nested-drag" aria-hidden="true"></delluna-icon>'
        +'<delluna-icon name="'+(item.icon||"circle")+'" class="expanded-drill-item-icon" aria-hidden="true"></delluna-icon>'
        +'<span class="expanded-drill-item-label">'+(item.label||item.name||"")+'</span>'
        +(item.customMenu||item.customSection?'<span class="expanded-drill-custom-badge">custom</span>':"")
        +(canMoveIn?'<button type="button" class="expanded-drill-move" aria-label="Drill in"><delluna-icon name="arrow_forward"></delluna-icon></button>':"")
        +(isDeletable?'<button type="button" class="expanded-drill-delete" aria-label="Remove"><delluna-icon name="delete"></delluna-icon></button>':"")
        +'<button type="button" class="expanded-drill-visibility '+(visible?"is-on":"is-off")+'" aria-pressed="'+visible+'" aria-label="'+(visible?"Hide ":"Show ")+(item.label||item.name||"")+'">'
        +'<delluna-icon name="'+(visible?"check_box":"check_box_outline_blank")+'"></delluna-icon></button>';

      /* drill in */
      row.addEventListener("click",function(e){
        if (e.target.closest(".expanded-drill-visibility")||e.target.closest(".nested-drag")||e.target.closest(".expanded-drill-delete")) return;
        if (!canMoveIn) return;
        var children=pageIndex===0?(item.items||[]):(item.children||[]);
        expandedNestedStack.push({key:item.id||item.label||item.name,label:item.label||item.name,items:children});
        dexBuildExpandedDrill(true,"forward");
      });
      var mb=row.querySelector(".expanded-drill-move");
      if (mb) mb.addEventListener("click",function(e){
        e.stopPropagation(); e.preventDefault();
        var children=pageIndex===0?(item.items||[]):(item.children||[]);
        expandedNestedStack.push({key:item.id||item.label||item.name,label:item.label||item.name,items:children});
        dexBuildExpandedDrill(true,"forward");
      });

      /* visibility toggle */
      row.querySelector(".expanded-drill-visibility").addEventListener("click",function(e){
        e.stopPropagation(); e.preventDefault();
        dexSetNodeVisible(item,pageIndex,!visible);
        dexBuildExpandedDrill(false,direction);
        dexApplyBarState(currentExpandedBarId);
      });

      /* delete */
      var db=row.querySelector(".expanded-drill-delete");
      if (db) db.addEventListener("click",function(e){
        e.stopPropagation(); e.preventDefault();
        var prevLv=pageIndex>0?expandedNestedStack[pageIndex-1]:null;
        var src=pageIndex===0?(DEX_DEPTS[currentExpandedBarId]||[]):(prevLv?prevLv.items||[]:[]);
        var idx=src.indexOf(item); if (idx===-1) return; src.splice(idx,1);
        var delKey=item.id||item.label||item.name;
        for (var si=0;si<expandedNestedStack.length;si++){if(expandedNestedStack[si].key===delKey){expandedNestedStack.splice(si);break;}}
        dexBuildExpandedDrill(false,"back");
        if (currentExpandedBarId){var ids=DEX_BAR_SEL[currentExpandedBarId];if(item.id){var ii=ids.indexOf(item.id);if(ii!==-1)ids.splice(ii,1);} dexApplyBarState(currentExpandedBarId);}
      });

      /* drag-and-drop reorder */
      row.addEventListener("dragstart",function(e){row.classList.add("is-dragging");dragIndex=itemIndex;e.dataTransfer.effectAllowed="move";});
      row.addEventListener("dragend",function(){row.classList.remove("is-dragging");dragIndex=null;page.querySelectorAll(".expanded-drill-item").forEach(function(r){r.classList.remove("is-dragover");});});
      row.addEventListener("dragover",function(e){e.preventDefault();e.dataTransfer.dropEffect="move";row.classList.add("is-dragover");});
      row.addEventListener("dragleave",function(){row.classList.remove("is-dragover");});
      row.addEventListener("drop",function(e){
        e.preventDefault(); row.classList.remove("is-dragover");
        var from=dragIndex,to=itemIndex; if (from===null||from===to) return;
        var prevLv2=pageIndex>0?expandedNestedStack[pageIndex-1]:null;
        var src2=pageIndex===0?(DEX_DEPTS[currentExpandedBarId]||[]):(prevLv2?prevLv2.items||[]:[]);
        var moved=src2.splice(from,1)[0]; src2.splice(to,0,moved);
        dexBuildExpandedDrill(false,direction);
        if (currentExpandedBarId) dexApplyBarState(currentExpandedBarId);
      });
      page.appendChild(row);
    });
    if (!items.length){var emp=document.createElement("div");emp.className="expanded-drill-empty";emp.textContent="No items at this level.";page.appendChild(emp);}
    track.appendChild(page);
  });

  dexBuildExpandedBreadcrumb();
  track.dataset.depth=String(targetDepth);
  requestAnimationFrame(function(){
    if (animate&&prevDepth!==targetDepth){
      track.style.transition="none";
      track.style.transform="translateX(-"+(Math.max(0,direction==="back"?targetDepth+1:targetDepth-1)*100)+"%)";
      requestAnimationFrame(function(){
        track.style.transition="transform .35s cubic-bezier(.4,0,.2,1)";
        track.style.transform="translateX(-"+(targetDepth*100)+"%)";
      });
    } else { track.style.transform="translateX(-"+(targetDepth*100)+"%)"; }
  });
}
function buildExpandedPanel(){dexBuildExpandedDrill(false);}

/* -- Builder ----------------------------------------------------- */
function dexOpenBuilder(mode){
  builderMode=mode;
  builderTargetItems=expandedNestedStack.length?(expandedNestedStack[expandedNestedStack.length-1].items||[]):(DEX_DEPTS[currentExpandedBarId]||[]);
  var p=document.getElementById("expandedBuilder"),b=document.getElementById("expandedBuilderBackdrop"),inp=document.getElementById("expandedBuilderName"),ii=document.getElementById("expandedBuilderIcon");
  if (!p||!b||!inp) return;
  document.getElementById("expandedBuilderKicker").textContent=mode==="menu"?"NEW SECTION":"NEW GROUP";
  document.getElementById("expandedBuilderTitle").textContent=mode==="menu"?"Create a new section":"Create a new group";
  inp.value=""; if(ii)ii.value="";
  p.classList.add("open"); b.classList.add("open"); p.setAttribute("aria-hidden","false"); b.setAttribute("aria-hidden","false");
  requestAnimationFrame(function(){inp.focus();});
}
function dexCloseBuilder(){
  var p=document.getElementById("expandedBuilder"),b=document.getElementById("expandedBuilderBackdrop");
  if(p){p.classList.remove("open");p.setAttribute("aria-hidden","true");} if(b){b.classList.remove("open");b.setAttribute("aria-hidden","true");}
}
function dexCommitBuilder(){
  var inp=document.getElementById("expandedBuilderName"),ii=document.getElementById("expandedBuilderIcon");
  if (!inp||!builderTargetItems) return;
  var name=inp.value.trim(); if(!name){inp.focus();return;}
  var icon=(ii&&ii.value?ii.value.trim():"")||"circle";
  var uid="custom-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,7);
  var node=builderMode==="menu"
    ?{id:uid,icon:icon,name:name,label:name,hidden:false,moveIn:true,items:[],customMenu:true}
    :{id:uid,icon:icon,name:name,label:name,hidden:false,moveIn:true,children:[],customSection:true};
  builderTargetItems.push(node);
  if(builderMode==="menu"&&currentExpandedBarId){var ids=DEX_BAR_SEL[currentExpandedBarId];if(ids.indexOf(node.id)===-1)ids.push(node.id);}
  dexCloseBuilder(); dexBuildExpandedDrill(false);
  if(currentExpandedBarId) dexApplyBarState(currentExpandedBarId);
}

/* -- Picker ------------------------------------------------------ */
function dexCollectSourceNodes(){
  var out=[],other=currentExpandedBarId==="topbar"?"fm":"topbar";
  (DEX_DEPTS[other]||[]).forEach(function(dept){
    (dept.items||[]).forEach(function(item){
      out.push({item:item,path:dept.name+"/"+(item.label||item.name||""),key:item.id||item.label});
    });
  });
  return out;
}
function dexOpenExistingPicker(){
  var p=document.getElementById("expandedPicker"),b=document.getElementById("expandedPickerBackdrop"),q=document.getElementById("expandedPickerSearch");
  if(!p||!b||!q) return;
  dexRenderExistingPicker("");
  p.classList.add("open"); b.classList.add("open"); p.setAttribute("aria-hidden","false"); b.setAttribute("aria-hidden","false");
  requestAnimationFrame(function(){q.focus();});
}
function dexCloseExistingPicker(){
  var p=document.getElementById("expandedPicker"),b=document.getElementById("expandedPickerBackdrop");
  if(p){p.classList.remove("open");p.setAttribute("aria-hidden","true");} if(b){b.classList.remove("open");b.setAttribute("aria-hidden","true");}
}
function dexRenderExistingPicker(query){
  var lst=document.getElementById("expandedPickerList"); if(!lst) return;
  var q=(query||"").trim().toLowerCase();
  var srcs=dexCollectSourceNodes().filter(function(s){var l=(s.item.label||s.item.name||"").toLowerCase();return !q||l.indexOf(q)!==-1||s.path.toLowerCase().indexOf(q)!==-1;});
  lst.innerHTML="";
  if(!srcs.length){lst.innerHTML='<div class="expanded-picker-empty">No matching items.</div>';return;}
  srcs.forEach(function(s){
    var row=document.createElement("button"); row.type="button"; row.className="expanded-picker-row";
    var ic=document.createElement("delluna-icon"); ic.setAttribute("name",s.item.icon||"circle"); ic.className="expanded-picker-row-icon";
    var main=document.createElement("span"); main.className="expanded-picker-row-main";
    var lbl=document.createElement("span"); lbl.className="expanded-picker-row-label"; lbl.textContent=s.item.label||s.item.name||"";
    var pth=document.createElement("span"); pth.className="expanded-picker-row-path"; pth.textContent=s.path;
    main.append(lbl,pth); row.append(ic,main);
    row.addEventListener("click",function(){dexAddExistingShortcut(s.item,s.path);});
    lst.appendChild(row);
  });
}
function dexAddExistingShortcut(source,sourcePath){
  var target=expandedNestedStack.length?(expandedNestedStack[expandedNestedStack.length-1].items||[]):(DEX_DEPTS[currentExpandedBarId]||[]);
  if(!target) return;
  target.push({id:"sc-"+Date.now().toString(36),icon:source.icon||"circle",label:source.label||source.name||"",hidden:false,moveIn:false,children:[],shortcut:true,sourceId:source.id||null,sourcePath:sourcePath});
  dexCloseExistingPicker(); dexBuildExpandedDrill(false);
  if(currentExpandedBarId) dexApplyBarState(currentExpandedBarId);
}

/* -- Event wiring: runs once the panel markup exists -- */
function dexWireExpandedNav(){
  var map={
    expandedClose:            closeExpandedNavigation,
    expandedBuilderClose:     dexCloseBuilder,
    expandedBuilderCancel:    dexCloseBuilder,
    expandedBuilderSave:      dexCommitBuilder,
    expandedBuilderBackdrop:  dexCloseBuilder,
    expandedPickerClose:      dexCloseExistingPicker,
    expandedPickerBackdrop:   dexCloseExistingPicker,
    expandedRouteMapBackdrop: dexCloseExpandedRouteMap
  };
  Object.keys(map).forEach(function(id){
    var el=document.getElementById(id); if(el) el.addEventListener("click",map[id]);
  });
  var q=document.getElementById("expandedPickerSearch");
  if(q) q.addEventListener("input",function(){dexRenderExistingPicker(q.value);});
  var ni=document.getElementById("expandedBuilderName"), ii2=document.getElementById("expandedBuilderIcon");
  [ni,ii2].forEach(function(el){
    if(!el) return;
    el.addEventListener("keydown",function(e){
      if(e.key==="Enter"){e.preventDefault();dexCommitBuilder();}
      if(e.key==="Escape"){e.preventDefault();dexCloseBuilder();}
    });
  });
  document.addEventListener("keydown",function(e){
    if(e.key==="Escape"){var p=document.getElementById("navigationExpanded");if(p&&p.classList.contains("open"))closeExpandedNavigation();}
  });
}
/* Injected dynamically, so DOMContentLoaded may already have fired. */
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",dexWireExpandedNav,{once:true});
else dexWireExpandedNav();
