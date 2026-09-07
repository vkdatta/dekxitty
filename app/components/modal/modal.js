let activeDropdownClose = null;

function renderDropdownMenuPortal(trigger, options, callback) {
  options = Array.isArray(options) ? options : [];
  if (activeDropdownClose) { activeDropdownClose(); activeDropdownClose = null; }
  document.querySelectorAll(".custom-dropdown-portal-menu").forEach((e) => e.remove());

  const menu = document.createElement("div");
  menu.className = "custom-dropdown-portal-menu";
  menu.setAttribute("role", "listbox");

  const searchContainer = document.createElement("div");
  searchContainer.className = "dropdown-search";
  searchContainer.innerHTML = `
    <div class="search-wrapper">
      <delluna-icon name="search" class="search-icon"></delluna-icon>
      <input type="text" class="search-input" placeholder="Search..." autocomplete="off">
    </div>
  `;

  const optionsList = document.createElement("div");
  optionsList.className = "options-list";

  const noResults = document.createElement("div");
  noResults.className = "no-results";
  noResults.textContent = "No matches found";
  noResults.style.display = "none";

  menu.appendChild(searchContainer);
  menu.appendChild(optionsList);
  menu.appendChild(noResults);
  document.body.appendChild(menu);

  const renderItems = (filterText = "") => {
    optionsList.innerHTML = "";
    const filtered = options.filter(o => {
      const label = typeof o === "object" ? o.label : String(o);
      return label.toLowerCase().includes(filterText.toLowerCase());
    });

    filtered.forEach((o) => {
      const opt = document.createElement("div");
      opt.className = "custom-dropdown-option";
      const val = typeof o === "object" ? o.value : o;
      const lbl = typeof o === "object" ? o.label : o;

      if (String(trigger.dataset.value) === String(val)) {
        opt.setAttribute("aria-selected", "true");
      }
      opt.textContent = lbl;

      opt.addEventListener("click", () => {
        callback(o);
        closeMenu();
      });
      optionsList.appendChild(opt);
    });

    noResults.style.display = filtered.length === 0 ? "block" : "none";
  };

  const updatePosition = () => {
    const rect = trigger.getBoundingClientRect();
    menu.style.width = rect.width + "px";
    let top = rect.bottom + window.scrollY + 5;
    let left = rect.left + window.scrollX;

    if (window.innerHeight - rect.bottom < 300 && rect.top > 300) {
      top = rect.top + window.scrollY - menu.offsetHeight - 5;
      menu.style.transformOrigin = "bottom center";
    }

    const rightEdge = left + rect.width;
    if (rightEdge > window.innerWidth) {
      left = window.innerWidth - rect.width - 10;
    }
    if (left < 0) left = 0;

    menu.style.left = left + "px";
    menu.style.top = top + "px";
  };

  renderItems();
  updatePosition();

  requestAnimationFrame(() => {
    menu.classList.add("active");
    trigger.setAttribute("aria-expanded", "true");
    const si = searchContainer.querySelector("input");
    si.focus();
  });

  const closeMenu = () => {
    menu.classList.remove("active");
    trigger.setAttribute("aria-expanded", "false");
    setTimeout(() => { if (menu.parentNode) menu.remove(); }, 230);
    document.removeEventListener("mousedown", closeOnOutside);
    window.removeEventListener("resize", updatePosition);
    window.removeEventListener("scroll", updatePosition);
    if (activeDropdownClose === closeMenu) activeDropdownClose = null;
  };

  function closeOnOutside(ev) {
    if (!menu.contains(ev.target) && ev.target !== trigger) closeMenu();
  }

  searchContainer.querySelector("input").addEventListener("input", (e) => {
    renderItems(e.target.value);
    updatePosition();
  });

  document.addEventListener("mousedown", closeOnOutside);
  window.addEventListener("resize", updatePosition);
  window.addEventListener("scroll", updatePosition, { passive: true });
  activeDropdownClose = closeMenu;

  return menu;
}

let modalBackdrop = null;
let modalResolver = null;
let modalScope = {};
let modalClearTimer = null; 

function ensureModal() {
  if (modalBackdrop) return;
  modalBackdrop = document.createElement("div");
  modalBackdrop.className = "modal-backdrop";
  modalBackdrop.setAttribute("aria-hidden", "true");
  document.body.appendChild(modalBackdrop);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalBackdrop.classList.contains("active")) {
      closeModal();
    }
  });
}

function closeModal(result = null) {
  if (modalBackdrop) {
    modalBackdrop.classList.remove("active");
    document.documentElement.style.overflow = "";
  }
  modalScope = {};
  if (modalResolver) {
    modalResolver(result);
    modalResolver = null;
  }

  if (modalClearTimer) {
    clearTimeout(modalClearTimer);
  }
  modalClearTimer = setTimeout(() => {
    if (modalBackdrop && !modalBackdrop.classList.contains("active")) {
      modalBackdrop.innerHTML = "";
    }
    modalClearTimer = null;
  }, 300);
}

function applyModalStyles(element) {
  if (element.tagName === "INPUT") element.classList.add("modal-input");
  else if (element.tagName === "TEXTAREA") element.classList.add("modal-textarea");
  else if (element.tagName === "SELECT") element.classList.add("modal-select");
  else if (element.tagName === "BUTTON") element.classList.add("modal-btn");

  element.querySelectorAll("input, textarea, select, button").forEach(child => {
    applyModalStyles(child);
  });
}

function createModalScope(container) {
  const scope = {};
  container.querySelectorAll("[id]").forEach((el) => {
    scope[el.id] = el;
  });
  return scope;
}

function validateModalFields(container) {
  let isValid = true;
  container.querySelectorAll("input, textarea, .custom-dropdown-trigger").forEach((field) => {
    if (field.hasAttribute("data-skip-validation")) return;
    let val = "";
    if (field.classList.contains("custom-dropdown-trigger")) {
      val = (field.dataset.value || "").trim();
    } else {
      val = field.value.trim();
    }
    if (!val) {
      field.style.borderColor = "#ff4444";
      isValid = false;
      const clear = () => {
        field.style.borderColor = "";
        field.removeEventListener("input", clear);
        field.removeEventListener("change", clear);
      };
      field.addEventListener("input", clear);
      field.addEventListener("change", clear);
    }
  });
  return isValid;
}

function collectFormValues(container) {
  const values = {};
  container.querySelectorAll("[id]").forEach((el) => {
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      values[el.id] = el.checked;
    } else if (el.classList.contains("custom-dropdown-trigger")) {
      values[el.id] = el.dataset.value;
    } else {
      values[el.id] = el.value;
    }
  });
  return values;
}

window.showModal = function (options = {}) {
  ensureModal();

  if (modalResolver) {
    const prevResolve = modalResolver;
    modalResolver = null;
    prevResolve(null);
  }

  if (modalClearTimer) {
    clearTimeout(modalClearTimer);
    modalClearTimer = null;
  }

  return new Promise((resolve) => {
    modalResolver = resolve;
    modalBackdrop.innerHTML = "";
    const modalWindow = document.createElement("div");
    modalWindow.className = "modal-window";

    const headerDiv = document.createElement("div");
    headerDiv.className = "modal-header";
    if (options.header) {
      if (typeof options.header === "string") headerDiv.innerHTML = options.header;
      else headerDiv.appendChild(options.header);
    } else {
      headerDiv.innerHTML = `<h3 class="modal-title">${options.title || ""}</h3><button class="modal-close"><delluna-icon name="close"></delluna-icon></button>`;
      headerDiv.querySelector(".modal-close").addEventListener("click", () => closeModal());
    }

    const bodyDiv = document.createElement("div");
    bodyDiv.className = "modal-body";
    if (typeof options.body === "string") bodyDiv.innerHTML = options.body;
    else if (options.body instanceof HTMLElement) bodyDiv.appendChild(options.body);
    else if (Array.isArray(options.body)) bodyDiv.innerHTML = options.body.join("");

    const footerDiv = document.createElement("div");
    footerDiv.className = "modal-footer";
    if (options.footer) {
      if (typeof options.footer === "string") footerDiv.innerHTML = options.footer;
      else footerDiv.appendChild(options.footer);
    } else {
      footerDiv.innerHTML = '<button class="modal-btn">OK</button>';
    }

    applyModalStyles(headerDiv);
    applyModalStyles(bodyDiv);
    applyModalStyles(footerDiv);
    modalScope = createModalScope(bodyDiv);

    bodyDiv.querySelectorAll(".custom-dropdown-trigger").forEach((trigger) => {
      const opts = JSON.parse(trigger.dataset.options || "[]");
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        renderDropdownMenuPortal(trigger, opts, (selected) => {
          trigger.textContent = selected.label;
          trigger.dataset.value = selected.value;
          trigger.dispatchEvent(new Event("change", { bubbles: true }));
        });
      });
    });

    footerDiv.querySelectorAll("button").forEach((btn) => {
      if (btn.hasAttribute("onclick")) return;
      const isDismissive = btn.hasAttribute("data-skip-validation") ||
        /^(cancel|close|dismiss|no)$/i.test((btn.textContent || "").trim());
      btn.addEventListener("click", () => {
        if (isDismissive) { closeModal(null); return; }
        if (validateModalFields(bodyDiv)) {
          closeModal({ action: btn.textContent, values: collectFormValues(bodyDiv) });
        }
      });
    });

    modalWindow.append(headerDiv, bodyDiv, footerDiv);
    modalBackdrop.appendChild(modalWindow);

    void modalBackdrop.offsetWidth;

    document.documentElement.style.overflow = "hidden";
    modalBackdrop.classList.add("active");
  });
};

window.createModalElement = function (type, opts = {}) {
  const out = { el: null, input: null };
  const wrapper = document.createElement("div");
  wrapper.className = "modal-element";

  if (opts.label) {
    const lbl = document.createElement("label");
    lbl.className = "modal-label";
    lbl.textContent = opts.label;
    wrapper.appendChild(lbl);
  }

  if (type === "input") {
    const input = document.createElement("input");
    input.className = "modal-input";
    input.type = opts.inputType || "text";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.value) input.value = opts.value;
    wrapper.appendChild(input);
    out.input = input;
  } else if (type === "select") {
    const container = document.createElement("div");
    container.className = "custom-dropdown";
    const trigger = document.createElement("div");
    trigger.className = "custom-dropdown-trigger modal-input";
    trigger.tabIndex = 0;
    const options = opts.options || [];
    trigger.textContent = options[0]?.label || "";
    trigger.dataset.value = options[0]?.value || "";
    trigger.dataset.options = JSON.stringify(options);
    container.appendChild(trigger);
    wrapper.appendChild(container);
    out.input = trigger;
  } else if (type === "textarea") {
    const ta = document.createElement("textarea");
    ta.className = "modal-textarea";
    if (opts.placeholder) ta.placeholder = opts.placeholder;
    wrapper.appendChild(ta);
    out.input = ta;
  } else if (type === "row") {
    const row = document.createElement("div");
    row.className = "modal-row";
    if (opts.position) row.setAttribute("data-position", opts.position);
    (opts.children || []).forEach(c => row.appendChild(c.el || c));
    out.el = row;
    return out;
  }

  if (out.input && opts.key) out.input.id = opts.key;
  out.el = wrapper;
  return out;
};

ensureModal();
