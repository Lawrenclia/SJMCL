import { build } from "esbuild";
import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as wait } from "node:timers/promises";

const { outputFiles } = await build({
  entryPoints: ["src/utils/chat-stream.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { createChatStream } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

test("coalesces a burst of chunks into one complete update", async () => {
  const updates = [];
  const stream = createChatStream((content) => updates.push(content));
  for (let i = 0; i < 100; i++) stream.append("片段");
  assert.equal(updates.length, 0);
  await wait(80);
  assert.deepEqual(updates, ["片段".repeat(100)]);
  assert.equal(stream.finish(), "片段".repeat(100));
});

test("completion preserves the unpublished tail and clears pending work", async () => {
  const updates = [];
  const stream = createChatStream((content) => updates.push(content));
  stream.append("已展示");
  await wait(80);
  stream.append("最后一个片段");
  assert.equal(stream.finish(), "已展示最后一个片段");
  await wait(80);
  assert.deepEqual(updates, ["已展示"]);
});

test("immediate completion returns all chunks without a late UI update", async () => {
  const updates = [];
  const stream = createChatStream((content) => updates.push(content));
  stream.append("短回复");
  assert.equal(stream.finish(), "短回复");
  await wait(80);
  assert.deepEqual(updates, []);
});
