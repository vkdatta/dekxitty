export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function SHA256() {
  if (!noteTextarea) return;
  noteTextarea.value = await sha256Hex(noteTextarea.value);
  updateNoteMetadata();
  showNotification("SHA-256 Generated!");
}
