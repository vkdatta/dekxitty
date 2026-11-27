// Workflow adapter: exposes the text-in / text-out tools to automations.js.
import { TOOLS } from "./catalog.js";
import { decodeAs, utf8 } from "./lib/bytes.js";
import { ENC } from "./modals/shared.js";

export const toolFunctionName = (id) => "tool_" + id.replace(/-/g, "_");

export const TOOL_AUTOMATIONS = Object.fromEntries(TOOLS.filter((t) => t.auto).map((t) => {
  const params = t.fields.map((f) => ({ ...f, required: false }));
  if (t.input === "data") params.unshift({ key: "inputEnc", label: "Read the note as", type: "select", options: ENC, default: t.inputEnc || "utf8" });
  return [toolFunctionName(t.id), {
    params,
    run: async (text, p) => {
      const ctx = { text: async () => text, data: async () => (t.input === "data" ? decodeAs(text, p.inputEnc || t.inputEnc || "utf8") : utf8(text)) };
      const r = await t.run(ctx, p);
      if (typeof r === "string") return r;
      if (r.binary) throw new Error("The result is binary data, which cannot replace a text note");
      return r.text;
    }
  }];
}));
