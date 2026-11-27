import * as Z from "../lib/compress.js";
import { textStrict, toBase64 } from "../lib/bytes.js";
import { select, input } from "./shared.js";

const G = "Compression";
const size = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB");
const packed = (bytes, from, name) => ({ text: toBase64(bytes), bytes, name, note: `${size(from)} → ${size(bytes.length)}. Download saves the real ${name} file; the box shows it as Base64.` });
const unpacked = (bytes, name) => { const t = textStrict(bytes); return t === null ? { text: "", bytes, name, note: `Binary result (${size(bytes.length)}). Use Download to save it.` } : { text: t, bytes, name, note: size(bytes.length) }; };
const stem = (n, ext, fallback) => (n ? (n.toLowerCase().endsWith("." + ext) ? n.slice(0, -ext.length - 1) : n + ".out") : fallback);

function codec(id, label, key, refs) {
  const c = Z.CODECS[key];
  return [
    { id: id + "-compress", name: label + " Compress", group: G, icon: "compress", refs: refs[0], input: "data", action: "Compress", fields: [],
      run: async (ctx) => { const d = await ctx.data(); return packed(await c.compress(d, ctx.fileName || ""), d.length, (ctx.fileName || "data") + "." + c.ext); } },
    { id: id + "-decompress", name: label + " Decompress", group: G, icon: "compress", refs: refs[1], input: "data", inputEnc: "base64", action: "Decompress", fields: [],
      run: async (ctx) => { const d = await ctx.data(); const name = key === "gzip" ? Z.gzipName(d) : ""; return unpacked(await c.decompress(d), name || stem(ctx.fileName, c.ext, "decompressed.txt")); } }
  ];
}
const four = (n) => [[n + " Compress", n + " Create"], [n + " Decompress", n + " Extract"]];
const DEFLATE = [select("format", "Format", [{ label: "Raw DEFLATE", value: "deflate-raw" }, { label: "zlib wrapper", value: "deflate" }])];

const archive = (id, label, create, extract, ext) => [
  { id: id + "-create", name: label + " Create", group: G, icon: "compress", refs: [label + " Create"], input: "files", action: "Create",
    fields: [input("name", "Archive name", { default: "archive." + ext })],
    run: async (ctx, v) => { const files = await ctx.files(); const b = await create(files); return { text: files.map((f) => `${f.name}  (${size(f.data.length)})`).join("\n"), bytes: b, name: v.name || "archive." + ext, note: `${files.length} file(s) packed, ${size(b.length)}. Press Download.`, binaryOnly: true }; } },
  { id: id + "-extract", name: label + " Extract", group: G, icon: "folder_open", refs: [label + " Extract"], input: "file", accept: "." + ext, action: "Extract", fields: [],
    run: async (ctx) => { const files = await extract(await ctx.data()); return { text: files.map((f) => `${f.name}  (${size(f.data.length)})`).join("\n"), entries: files, note: `${files.length} file(s). Tap a name below to download it.`, binaryOnly: true }; } }
];

export default [
  ...codec("gzip", "GZIP", "gzip", four("GZIP")),
  ...codec("brotli", "Brotli", "brotli", four("Brotli")),
  ...codec("zstd", "Zstandard", "zstandard", four("Zstandard")),
  ...codec("xz", "XZ", "xz", four("XZ")),
  ...codec("lzip", "LZIP", "lzip", four("LZIP")),
  ...codec("lzma", "LZMA-Alone", "lzma", four("LZMA-Alone")),
  { id: "deflate-compress", name: "DEFLATE Compress", group: G, icon: "compress", refs: ["DEFLATE Compress"], input: "data", action: "Compress", fields: DEFLATE,
    run: async (ctx, v) => { const d = await ctx.data(); return packed(await Z.deflate(d, v.format), d.length, (ctx.fileName || "data") + ".deflate"); } },
  { id: "deflate-decompress", name: "DEFLATE Decompress", group: G, icon: "compress", refs: ["DEFLATE Decompress"], input: "data", inputEnc: "base64", action: "Decompress", fields: DEFLATE,
    run: async (ctx, v) => unpacked(await Z.inflate(await ctx.data(), v.format), stem(ctx.fileName, "deflate", "inflated.txt")) },
  ...archive("zip", "ZIP", Z.zipCreate, Z.zipExtract, "zip"),
  ...archive("tar", "TAR", async (f) => Z.tarCreate(f), async (d) => Z.tarExtract(d), "tar")
];
