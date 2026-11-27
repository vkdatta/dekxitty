// Run from anywhere:  node --test app/components/sidebar2/functions/6tools/tests/tools.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TOOLS } from "../catalog.js";
import { TOOL_AUTOMATIONS, toolFunctionName } from "../automation.js";
import { source } from "./build-registry.mjs";

const run = (id, text, params = {}) => {
  const a = TOOL_AUTOMATIONS[toolFunctionName(id)];
  const defaults = Object.fromEntries(a.params.map((f) => [f.key, f.default]));
  return a.run(text, { ...defaults, ...params });
};

test("ids and covered tool names are unique", () => {
  const ids = TOOLS.map((t) => t.id), refs = TOOLS.flatMap((t) => t.refs);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(refs).size, refs.length);
  // 208 reference tools, minus HTML Strip, Text Compare and Syntax Highlight which the app already has
  assert.equal(refs.length, 205);
});

test("registry.js matches the catalog", () => {
  assert.equal(fs.readFileSync(new URL("../registry.js", import.meta.url), "utf8"), source, "run: node tests/build-registry.mjs");
});

test("every field is well formed", () => {
  for (const t of TOOLS) {
    const keys = t.fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, t.id);
    for (const f of t.fields) if (f.type === "select") assert.ok(f.options.some((o) => o.value === f.default), `${t.id}.${f.key}`);
    if (t.auto) assert.ok(!t.fields.some((f) => f.type === "textarea"), t.id + " has a field workflows cannot show");
  }
});

test("known answers", async () => {
  assert.equal(await run("md5", "abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(await run("sha256", "abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(await run("sha3-256", "abc"), "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532");
  assert.equal(await run("crc32", "123456789"), "cbf43926");
  assert.equal(await run("hmac", "The quick brown fox jumps over the lazy dog", { key: "key" }), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  assert.equal(await run("base64-encode", "hello"), "aGVsbG8=");
  assert.equal(await run("base64-decode", "aGVsbG8="), "hello");
  assert.equal(await run("case-converter", "hello big world", { case: "snake" }), "hello_big_world");
  assert.equal(await run("json-minify", '{ "a": [1, 2] }'), '{"a":[1,2]}');
});

test("binary decode results never overwrite a note in a workflow", async () => {
  await assert.rejects(run("hex-decode", "ff00ff"), /binary/);
});
