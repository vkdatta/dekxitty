// This site's DexIcons config — load after icons.js. Global default is
// 'plasma' (the plurality of your earlier per-icon picks in the old
// myvariation1.js bake); the icons below are the ones that picked something
// else, so they're the only entries that need listing. Everything not named
// here (copy, download, bolt, ... ) inherits 'plasma' from the default.
if (window.Delluna) {
  window.Delluna.configure({
    variant: 'plasma',
    icons: {
      folder: { variant: 'circuit' },
      file: { variant: 'circuit' },
      plus: { variant: 'orbit' },
      select: { variant: 'orbit' },
      trash: { variant: 'orbit' },
      tick: { variant: 'orbit' },
      enter: { variant: 'orbit' },
      up: { variant: 'orbit' },
      move: { variant: 'circuit' },
      paste: { variant: 'orbit' },
      chev: { variant: 'orbit' },
      sort: { variant: 'circuit' },
      selectAll: { variant: 'circuit' },
      edit: { variant: 'circuit' },
      undo: { variant: 'orbit' },
      redo: { variant: 'orbit' },

      // topbar icons — every one except undo/redo uses 'og'. Icon variants are
      // keyed by name, so this applies site-wide (file manager bar, expanded
      // navigation, sidebars ...), not just inside #topbar.
      x:                 { variant: 'og' },  // topbar close
      home_app_logo:     { variant: 'og' },
      fullscreen:        { variant: 'og' },
      import_contacts:   { variant: 'og' },  // Tom Riddle / voldemort toggle
      view_object_track: { variant: 'og' },  // sidebar 1
      view_cozy:         { variant: 'og' },  // sidebar 2
      open_in_full:      { variant: 'og' },  // expanded navigation
      tune: { variant: 'og' },
      bug_report: { variant: 'hud' },
      logout: { variant: 'orbit' },
      settings: { variant: 'circuit' },
      star: { variant: 'orbit' },
      arrow_forward: { variant: 'orbit' },
      arrow_back: { variant: 'orbit' },
      arrow_left: { variant: 'orbit' },
      remove: { variant: 'orbit' },
      backspace: { variant: 'og' },
      document_scanner: { variant: 'hud' },
      description: { variant: 'hud' },
      table: { variant: 'circuit' },
      format_color_fill: { variant: 'hud' },
      text_fields: { variant: 'hud' },
      uppercase: { variant: 'hud' },
      lowercase: { variant: 'hud' },
      match_case: { variant: 'hud' },
      text_up: { variant: 'hud' },
      fast_rewind: { variant: 'og' },
      align_horizontal_left: { variant: 'orbit' },
      format_align_left: { variant: 'orbit' },
      format_align_center: { variant: 'orbit' },
      format_align_right: { variant: 'orbit' },
      format_indent_decrease: { variant: 'orbit' },
      format_indent_increase: { variant: 'orbit' },
      alternate_email: { variant: 'orbit' },
      format_bold: { variant: 'orbit' },
      format_italic: { variant: 'orbit' },
      format_underlined: { variant: 'orbit' },
      format_list_bulleted: { variant: 'orbit' },
      format_list_numbered: { variant: 'orbit' },
      slab_serif: { variant: 'orbit' },
      switches: { variant: 'circuit' },
      regular_expression: { variant: 'hud' },
      key: { variant: 'circuit' },
      encrypted: { variant: 'circuit' },
      html: { variant: 'hud' },
      css: { variant: 'hud' },
      javascript: { variant: 'hud' },
      cleaning_services: { variant: 'circuit' },
      swap_horiz: { variant: 'circuit' },
      discover_tune: { variant: 'circuit' },
      category: { variant: 'hud' },
      save: { variant: 'hud' },
      bookmark: { variant: 'orbit' },
      swapSaved: { variant: 'orbit' },

      // grand functions / overlay chrome
      apps:        { variant: 'circuit' },
      play_arrow:  { variant: 'plasma'  },
      star_border: { variant: 'orbit'   },
      search_off:  { variant: 'hud'     },
      info:        { variant: 'orbit'   },
      route:       { variant: 'circuit' }
    }
  });
}
