import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/utils/tool-call/parser.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { findToolCalls } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

test("parses multiline instance calls containing download links", () => {
  const data = {
    name: "create_instance",
    params: {
      name: "ATM10-底座",
      description: "Minecraft 1.21.1 + NeoForge 21.1.264",
      gameInfo: { id: "1.21.1", url: "https://piston-meta.mojang.com/v1/packages/example/1.21.1.json" },
      modLoaderInfo: { loaderType: "NeoForge", version: "21.1.264", branch: null },
    },
  };
  const matches = findToolCalls(`准备创建实例。\n::tool::${JSON.stringify(data, null, 2)}\n稍后继续。`);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].type, "success");
  assert.deepEqual(matches[0].params, data.params);
});

test("ignores braces and escaped quotes inside script strings", () => {
  for (const script of ['Write-Host "}"', 'print("{ unmatched")', 'print("escaped \\\" } \\\")', 'C:\\Minecraft\\']) {
    const matches = findToolCalls(`::tool::${JSON.stringify({ name: "script", params: { script } })}`);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].type, "success");
    assert.equal(matches[0].params.script, script);
  }
});

test("keeps distinct positions for repeated calls across paragraphs and fences", () => {
  const call = '::tool::{"name":"query","params":{}}';
  const source = [call, "", "```json", call, "```"].join("\n");
  const matches = findToolCalls(source);
  assert.deepEqual(matches.map(match => match.type), ["success", "success"]);
  assert.equal(matches[0].startIndex, 0);
  assert.equal(matches[1].startIndex, source.lastIndexOf(call));
});

test("does not recognize incomplete or malformed JSON as executable calls", () => {
  assert.deepEqual(findToolCalls('::tool::{"name":"query","params":{'), []);
  assert.equal(findToolCalls('::tool::{"name":"query","params":invalid}')[0].type, "error");
  assert.deepEqual(findToolCalls('{"name":"query","params":{}}'), []);
});
