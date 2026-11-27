// Every tool in the "Tools" category. Add a tool to a modals/*.js file, then run:  node tests/build-registry.mjs
import hash from "./modals/hash.js";
import crypto_ from "./modals/crypto.js";
import compression from "./modals/compression.js";
import encoding from "./modals/encoding.js";
import format from "./modals/format.js";
import convert from "./modals/convert.js";
import generator from "./modals/generator.js";

export const TOOLS = [...hash, ...crypto_, ...compression, ...encoding, ...format, ...convert, ...generator];
export const TOOL_MAP = new Map(TOOLS.map((t) => [t.id, t]));
