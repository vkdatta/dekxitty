import * as F from "../lib/format.js";
import { select, input } from "./shared.js";

const G = "Convert";
const CASES = [["lower", "lower case"], ["upper", "UPPER CASE"], ["lower-camel", "lowerCamelCase"], ["upper-camel", "UpperCamelCase"], ["snake", "snake_case"], ["kebab", "kebab-case"], ["constant", "CONSTANT_CASE"]];

export default [
  { id: "case-converter", name: "Case Converter", group: G, icon: "match_case", refs: ["lower case", "UPPER CASE", "lower camel", "upper camel", "snake_case", "kebab-case", "CONSTANT_CASE"], input: "text", auto: true, action: "Convert",
    fields: [select("case", "Convert to", CASES.map(([value, label]) => ({ value, label })), "lower-camel")], run: async (c, v) => F.convertCase(await c.text(), v.case) },
  { id: "time-converter", name: "Time Converter", group: G, icon: "history", refs: ["Time Converter"], input: "none", action: "Convert",
    fields: [input("time", "Timestamp or date (blank = now)", { optional: true, placeholder: "1700000000 or 2026-11-27T10:00:00+05:30" }),
      select("unit", "Number unit", [{ label: "Detect automatically", value: "auto" }, { label: "Seconds", value: "s" }, { label: "Milliseconds", value: "ms" }, { label: "Microseconds", value: "us" }, { label: "Nanoseconds", value: "ns" }])],
    run: async (c, v) => F.convertTime(v.time || "", v.unit) }
];
