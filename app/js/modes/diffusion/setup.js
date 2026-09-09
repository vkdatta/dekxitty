  function diffCommit(type) { if (typeof diffCommitPane === 'function') diffCommitPane(type); }

  function diffSwapTexts() {
    const temp = diffElements.raw.value;
    diffElements.raw.value = diffElements.morph.value;
    diffElements.morph.value = temp;
    diffusion();
    if (typeof diffSwapBindings === 'function') diffSwapBindings();
    if (typeof showNotification === "function") showNotification("Swapped Raw and Morph");
  }