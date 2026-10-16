import * as B from "./blocks.js";
let fail=0; const eq=(a,b,m)=>{ if(JSON.stringify(a)!==JSON.stringify(b)){fail++;console.log("FAIL",m,"\n  got ",JSON.stringify(a),"\n  want",JSON.stringify(b));} };
const doc = "# Title\n\nSome *text*\nmore text\n\n- a\n- b\n\n  cont\n- c\n\n> quote\n> more\n\n```js\nlet x=1;\n\nlet y=2;\n```\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n\n---\n\n1. one\n2. two\n\nSetext\n===\n\n<div>\nhi\n</div>\n\n- [ ] t1\n- [x] t2\n";
const bl = B.splitBlocks(doc);
eq(bl.map(b=>b.type), ["heading","paragraph","list","quote","code","table","hr","list","heading","html","list"],"types");
// lossless: reassemble
let rebuilt=""; let pos=0; for(const b of bl){ rebuilt+=doc.slice(pos,b.start)+doc.slice(b.start,b.end); pos=b.end;} rebuilt+=doc.slice(pos);
eq(rebuilt,doc,"lossless");
eq(bl[2].task,false,"list not task"); eq(bl[10].task,true,"task list"); eq(bl[7].ordered,true,"ordered");
eq(doc.slice(bl[4].start,bl[4].end), "```js\nlet x=1;\n\nlet y=2;\n```","code with blank line");
eq(B.splitBlocks("").length,0,"empty"); eq(B.splitBlocks("\n\n  \n").length,0,"ws only");
eq(B.splitBlocks("---\ntitle: x\n---\n\n# H").map(b=>b.type),["front","heading"],"front matter");
eq(B.splitBlocks("Title\n---\n\npara").map(b=>b.type+(b.level||"")),["heading2","paragraph"],"setext h2");
eq(B.splitBlocks("a\n```\ncode\n```\nb").map(b=>b.type),["paragraph","code","paragraph"],"fence interrupts para");
eq(B.splitBlocks("```\nunclosed\ntext").map(b=>b.type),["code"],"unclosed fence");
eq(B.splitBlocks("a\r\nb\r\n\r\nc").length,2,"crlf");
// inline
eq(B.toggleWrap("hello world",0,5,"**"),{text:"**hello** world",s:2,e:7},"bold wrap");
eq(B.toggleWrap("**hello** world",2,7,"**"),{text:"hello world",s:0,e:5},"bold unwrap outside");
eq(B.toggleWrap("hello world",3,3,"*"),{text:"*hello* world",s:1,e:6},"word under caret");
eq(B.toggleWrap("a  b",2,2,"*"),{text:"a ** b",s:3,e:3},"empty pair");
eq(B.toggleWrap("**x**",2,3,"*"),{text:"***x***",s:3,e:4},"italic inside bold wraps");
eq(B.toggleWrap("hi",0,2,"~~"),{text:"~~hi~~",s:2,e:4},"strike");
// convert
eq(B.convertBlock("a\nb","ul"),"- a\n- b","ul"); eq(B.convertBlock("- a\n- b","ol"),"1. a\n2. b","ul->ol");
eq(B.convertBlock("- a\n- b","task"),"- [ ] a\n- [ ] b","->task"); eq(B.convertBlock("- [ ] a","task"),"a","task toggles off");
eq(B.convertBlock("## Hi","h1"),"# Hi","h2->h1"); eq(B.convertBlock("text","h2"),"## text","p->h2");
eq(B.convertBlock("# Hi","h1"),"Hi","h1 toggles off"); eq(B.convertBlock("a\nb","quote"),"> a\n> b","quote");
eq(B.convertBlock("```js\nx\n```","p"),"x","code->p"); eq(B.convertBlock("x\ny","code"),"```\nx\ny\n```","p->code");
eq(B.convertBlock("x","mermaid"),"```mermaid\nx\n```","->mermaid"); eq(B.convertBlock("> a\n> b","ul"),"- a\n- b","quote->ul");
eq(B.convertBlock("  - nested","ol"),"  1. nested","keeps indent");
// indent
eq(B.indentLines("- a\n- b",0,7,1).text,"  - a\n  - b","indent"); eq(B.indentLines("  - a",2,2,-1).text,"- a","outdent");
// smart enter
eq(B.smartEnter("- a",3,3),{text:"- a\n- ",s:6,e:6,exit:false},"enter bullet");
eq(B.smartEnter("1. a\n2. b",9,9).text,"1. a\n2. b\n3. ","enter ordered");
eq(B.smartEnter("- [x] a",7,7).text,"- [x] a\n- [ ] ","enter task");
eq(B.smartEnter("- a\n- ",6,6),{text:"- a",s:3,e:3,exit:true},"enter empty exits");
eq(B.smartEnter("- ",2,2),{text:"",s:0,e:0,exit:true},"only empty item");
eq(B.smartEnter("> a",3,3).text,"> a\n> ","quote enter"); eq(B.smartEnter("para",4,4),null,"para default");
eq(B.smartEnter("- a\n  - ",8,8).text,"- a\n- ","nested outdent");
eq(B.smartEnter("1. a\n2. b\n3. c",4,4).text,"1. a\n2. \n3. b\n4. c".replace("2. \n3. b\n4. c","2. \n3. b\n4. c"),"split renumbers") ;
// tables
const tt=B.parseTable("| a | b |\n|---|:-:|\n| 1 | 2 |\n| x \\| y | 3 |");
eq(tt,{head:["a","b"],align:["","c"],rows:[["1","2"],["x | y","3"]]},"parse");
eq(B.parseTable(B.serializeTable(tt)),tt,"roundtrip");
B.tableOps.addRow(tt,1); B.tableOps.addCol(tt,1); eq([tt.head.length,tt.rows.length,tt.rows[0].length],[3,3,3],"add");
B.tableOps.sort(tt,0,-1); eq(tt.rows[0][0],"x | y","sort desc");
const t2={head:["n"],align:[""],rows:[["10"],["9"],["100"]]}; B.tableOps.sort(t2,0,1); eq(t2.rows.map(r=>r[0]),["9","10","100"],"numeric sort");
eq(B.parseGrid("a\tb\nc\td"),[["a","b"],["c","d"]],"tsv"); eq(B.parseGrid('a,"b,c"\n1,2'),[["a","b,c"],["1","2"]],"csv"); eq(B.parseGrid("single"),null,"single");
const t3=B.newTable(1,1); B.tableOps.paste(t3,0,0,[["a","b"],["c","d"]]); eq([t3.head.length,t3.rows.length],[2,2],"paste grows");
eq(B.blockInfo(B.serializeTable(B.newTable(2,2))).type,"table","serialised is table");
// patches
const d2="# A\n\npara\n\n- x\n"; const b2=B.splitBlocks(d2);
eq(B.applyPatch(d2,B.patchMove(d2,b2,0,1)),"para\n\n# A\n\n- x\n","move down");
eq(B.applyPatch(d2,B.patchMove(d2,b2,2,-1)),"# A\n\n- x\n\npara\n","move up");
eq(B.applyPatch(d2,B.patchDelete(d2,b2,1)),"# A\n\n- x\n","delete mid"); eq(B.applyPatch(d2,B.patchDelete(d2,b2,2)),"# A\n\npara\n","delete last");
eq(B.applyPatch(d2,B.patchDuplicate(d2,b2,0)),"# A\n\n# A\n\npara\n\n- x\n","dup");
eq(B.applyPatch(d2,B.patchInsert(d2,b2,1,"> q")),"# A\n\npara\n\n> q\n\n- x\n","insert");
eq(B.applyPatch("",B.patchInsert("",[],-1,"hi")),"hi","insert empty doc");
eq(B.applyPatch("# A\n",B.patchInsert("# A\n",B.splitBlocks("# A\n"),-1,"top")),"top\n\n# A\n","insert top");
eq(B.findTaskLines("- [ ] a\n```\n- [ ] no\n```\n- [x] b"),[0,4],"task lines");
eq(B.blockAt(b2,5),1,"blockAt");
console.log(fail?("FAILED "+fail):"ALL OK");
