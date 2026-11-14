// node app/js/modes/csvexec/recogniser.test.mjs
import { recognise, DEFAULT_PROFORMA, validateProforma, parseDelimiterInput } from "./recogniser.js";
import assert from "node:assert/strict";

const PF = JSON.parse(JSON.stringify(DEFAULT_PROFORMA));
const run = (t, cfg) => recognise(t, cfg, PF);
const shape = (r) => `${r.rows.length}x${Math.max(...r.rows.map((x) => x.length))}`;
let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok  -", name); };

const S1 = `| Column A                  | Column B                        | Column C                 | Column D           |
| ------------------------- | ------------------------------- | ------------------------ | ------------------ |
| 125                       | Blue sky above mountains        | 48                       | 7,500              |
| 23                        | Apple                           | 900                      | Green forest trees |
| 1,250                     | 45                              | Silver moon light        | 86                 |
| Red car moves quickly     | 750                             | 12                       | 6,300              |
| 99                        | 88,500                          | Beautiful summer morning | 42                 |
| 5                         | 16                              | 27                       | 39                 |
| Golden sunrise over ocean | 2,450                           | 67                       | 800                |
| 14                        | Purple flowers bloom everywhere | 3,200                    | 91                 |
| 650                       | 72                              | 18                       | 44                 |
| 2026                      | Fast moving river water         | 350                      | 9,999              |`;
const S2 = `Column A Column B Column C Column D
125 Blue sky above mountains 48 7,500
23 Apple 900 Green forest trees
1,250 45 Silver moon light 86
Red car moves quickly 750 12 6,300
99 88,500 Beautiful summer morning 42
5 16 27 39
Golden sunrise over ocean 2,450 67 800
14 Purple flowers bloom everywhere 3,200 91
650 72 18 44
2026 Fast moving river water 350 9,999`;
const S3 = `Column A Column B Column C Column D
58 purple lantern garden 12 green frogs jumping moonlit river stones
904 three tiny blue birds 6 red boats sailing silver cloud forest path
77 warm bread and honey 23 orange kite in wind
41 silver keys quiet harbor at dawn 8 seven green apples falling
315 bright stars above lake 19 blue bicycles soft moss on stone`;
const S5 = `| ID / Ref | Metric or Description | Details |
|---|---|---|
| 042 | Average global rainfall | 1,200 millimeters per year |
| 7,450 | Escalated priority queue | Status: Pending verification |
| Quick-start guide | 99 steps to mastery | Version 2.0 release |
| 14.8 | High-density orbital sector | Sector alpha clearance required |
| 512 | Memory allocation buffer | 32 gigabytes available |
| Comprehensive review | 100 percent satisfaction rate | Final diagnostic passed |`;
const S6 = `ID / RefMetric or DescriptionDetails
042Average global rainfall1,200 millimeters per year
7,450Escalated priority queueStatus: Pending verification
Quick-start guide99 steps to masteryVersion 2.0 release
14.8High-density orbital sectorSector alpha clearance required
512Memory allocation buffer32 gigabytes available
Comprehensive review100 percent satisfaction rateFinal diagnostic passed`;
const S7 = `| # | Entry | Type | Length |
|---|-------|------|--------|
| 1 | 42 | Number | 1 |
| 2 | Purple elephants dancing quietly | Words | 4 |
| 3 | 7 lazy turtles | Combo | 3 |
| 4 | 1999 | Number | 1 |
| 5 | Midnight train to nowhere | Words | 4 |
| 6 | 3.14159 | Number | 1 |
| 7 | 12 angry badgers eating pancakes | Combo | 5 |
| 8 | Whispering winds over frozen lakes | Words | 5 |
| 9 | 808 | Number | 1 |
| 10 | Route 66 at sunset | Combo | 4 |`;
const vert = (t) => t.split("\n").join("\n");
const S8 = ["#","Entry","Type","Length","1","42","Number","1","2","Purple elephants dancing quietly","Words","4","3","7 lazy turtles","Combo","3","4","1999","Number","1","5","Midnight train to nowhere","Words","4","6","3.14159","Number","1","7","12 angry badgers eating pancakes","Combo","5","8","Whispering winds over frozen lakes","Words","5","9","808","Number","1","10","Route 66 at sunset","Combo","4"].join("\n");
const S9 = `| ID | Item / Phrase | Quantity | Notes | Code |
|----|---------------|----------|-------|------|
| 87 | — | — | — | — |
| — | Bright silver moon over quiet lake | — | — | — |
| 15 | Golden leaves falling slowly | 42 | Autumn scene | A7 |
| — | Crystal clear mountain stream water | — | — | — |
| 9 | — | — | — | — |
| — | Soft velvet curtains and warm candlelight | 3 | Cozy room | V2 |
| 204 | — | — | — | — |
| — | Ancient oak tree standing alone | — | — | — |
| 6 | Red apples and 2 green pears | 11 | Fruit basket | F9 |
| 33 | Silent forest path under starry sky | 8 | Night walk | S4 |`;
const S9V = ["ID","Item / Phrase","Quantity","Notes","Code","87","—","—","—","—","—","Bright silver moon over quiet lake","—","—","—","15","Golden leaves falling slowly","42","Autumn scene","A7","—","Crystal clear mountain stream water","—","—","—","9","—","—","—","—","—","Soft velvet curtains and warm candlelight","3","Cozy room","V2","204","—","—","—","—","—","Ancient oak tree standing alone","—","—","—","6","Red apples and 2 green pears","11","Fruit basket","F9","33","Silent forest path under starry sky","8","Night walk","S4"].join("\n");
const S10 = `| Row | Content |
| --- | --- |
| 1 | 42 |
| 2 | apple banana cherry |
| 3 | 7 dogs bark loudly |
| 4 | 100 |
| 5 | red green blue yellow |
| 6 | 3 cats and 2 dogs |
| 7 | pizza pasta sushi |
| 8 | 55 |
| 9 | 12 angry men |
| 10 | coffee tea milk sugar |`;

ok("1 pipe table", () => { const r = run(S1); assert.equal(r.pattern, "pipe"); assert.equal(shape(r), "11x4"); assert.deepEqual(r.rows[2], ["23", "Apple", "900", "Green forest trees"]); });
ok("2 flattened words+numbers", () => { const r = run(S2); assert.equal(r.pattern, "runs"); assert.equal(shape(r), "11x4"); assert.deepEqual(r.rows[0], ["Column A","Column B","Column C","Column D"]); assert.deepEqual(r.rows[3], ["1,250","45","Silver moon light","86"]); assert.deepEqual(r.rows[4], ["Red car moves quickly","750","12","6,300"]); assert.deepEqual(r.rows[6], ["5","16","27","39"]); });
ok("3 flattened long phrases", () => { const r = run(S3); assert.equal(r.pattern, "runs"); assert.deepEqual(r.rows[4], ["41","silver keys quiet harbor at dawn","8","seven green apples falling"]); assert.deepEqual(r.rows[1], ["58","purple lantern garden","12","green frogs jumping moonlit river stones"]); });
ok("5 pipe 3 cols", () => { const r = run(S5); assert.equal(r.pattern, "pipe"); assert.equal(shape(r), "7x3"); });
ok("6 glued (separators lost)", () => { const r = run(S6); assert.equal(r.pattern, "glued"); assert.deepEqual(r.rows[0], ["ID / Ref","Metric or Description","Details"]); assert.deepEqual(r.rows[1], ["042","Average global rainfall","1,200 millimeters per year"]); assert.deepEqual(r.rows[3], ["Quick-start guide","99 steps to mastery","Version 2.0 release"]); assert.deepEqual(r.rows[4], ["14.8","High-density orbital sector","Sector alpha clearance required"]); assert.deepEqual(r.rows[6], ["Comprehensive review","100 percent satisfaction rate","Final diagnostic passed"]); });
ok("7 pipe with # column", () => { const r = run(S7); assert.equal(r.pattern, "pipe"); assert.equal(shape(r), "11x4"); assert.deepEqual(r.rows[7], ["7","12 angry badgers eating pancakes","Combo","5"]); });
ok("8 one cell per line (4 cols)", () => { const r = run(S8); assert.equal(r.pattern, "vertical"); assert.equal(shape(r), "11x4"); assert.deepEqual(r.rows[2], ["2","Purple elephants dancing quietly","Words","4"]); assert.deepEqual(r.rows[10], ["10","Route 66 at sunset","Combo","4"]); });
ok("9 pipe with em-dash empties", () => { const r = run(S9); assert.equal(r.pattern, "pipe"); assert.deepEqual(r.rows[1], ["87","","","",""]); assert.deepEqual(r.rows[3], ["15","Golden leaves falling slowly","42","Autumn scene","A7"]); });
ok("9 one cell per line (5 cols, empties)", () => { const r = run(S9V); assert.equal(r.pattern, "vertical"); assert.equal(shape(r), "11x5"); assert.deepEqual(r.rows[2], ["","Bright silver moon over quiet lake","","",""]); assert.deepEqual(r.rows[10], ["33","Silent forest path under starry sky","8","Night walk","S4"]); });
ok("10 pipe row/content", () => { const r = run(S10); assert.equal(r.pattern, "pipe"); assert.equal(shape(r), "11x2"); });

ok("plain CSV is untouched", () => { const r = run("a,b,c\n1,2,3\n4,5,6"); assert.equal(r.pattern, "delimited"); assert.deepEqual(r.rows[1], ["1","2","3"]); });
ok("plain TSV", () => { const r = run("a\tb\n1\t2"); assert.equal(r.pattern, "delimited"); assert.equal(shape(r), "2x2"); });
ok("quoted CSV with commas inside", () => { const r = run('n,v\n"a, b",1\n"c, d",2'); assert.deepEqual(r.rows[1], ["a, b","1"]); });
ok("single line stays one cell", () => { const r = run("hello, world", { plainDelimiter: "\t" }); assert.deepEqual(r.rows, [["hello, world"]]); });
ok("prose is not turned into a table", () => { const r = run("I have 3 apples\nWe saw 4 dogs today\nShe ate 2 pears quickly", { plainDelimiter: "\t" }); assert.equal(r.pattern, "plain"); assert.equal(shape(r), "3x1"); });
ok("plain list of names stays a column", () => { const r = run("alice\nbob\ncarol\ndave\neve\nfrank", { plainDelimiter: "\t" }); assert.equal(r.pattern, "plain"); assert.equal(shape(r), "6x1"); });

ok("note setting: force a pattern", () => { const r = run(S2, { pattern: "plain" }); assert.equal(r.pattern, "plain"); const g = run(S6, { pattern: "glued" }); assert.equal(g.forced, true); assert.equal(shape(g), "7x3"); });
ok("note setting: custom delimiter", () => { const r = run("a::b::c\n1::2::3", { delimiter: "::" }); assert.equal(r.forced, true); assert.deepEqual(r.rows[1], ["1","2","3"]); const t = run("a;b\n1;2", { delimiter: parseDelimiterInput("semicolon") }); assert.equal(shape(t), "2x2"); });
ok("pro-forma: disabling a pattern", () => { const pf = JSON.parse(JSON.stringify(DEFAULT_PROFORMA)); pf.patterns.find((p) => p.id === "glued").enabled = false; assert.equal(recognise(S6, {}, pf).pattern, "plain"); });
ok("pro-forma: validation", () => { assert.equal(validateProforma(DEFAULT_PROFORMA).ok, true); const bad = JSON.parse(JSON.stringify(DEFAULT_PROFORMA)); bad.patterns[2].params.splitRegex = "("; assert.equal(validateProforma(bad).ok, false); });
console.log(`\n${n} passed`);
