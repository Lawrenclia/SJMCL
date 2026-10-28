import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../tauri.js", import.meta.url), "utf8");

function runCommand(platform, args, options = {}) {
  const calls = [];
  const originalEnv = { KEEP: "existing", RUSTC: "old-compiler" };
  let exitCode;
  const mockRequire = (name) => {
    if (name === "node:path") return path;
    if (name === "node:child_process")
      return {
        execFileSync: (...args) => {
          calls.push({ kind: "rustup", args });
          if (options.lookupFails) throw new Error("stable unavailable");
          return "C:/Rust Stable\n";
        },
        spawnSync: (...args) => {
          calls.push({ kind: "cli", args });
          return { status: options.status ?? 0 };
        },
      };
    throw new Error(`Unexpected module ${name}`);
  };
  mockRequire.resolve = () => "tauri-cli-entry.js";
  vm.runInNewContext(source, {
    require: mockRequire,
    process: {
      platform,
      argv: ["node", "tauri.js", ...args],
      env: originalEnv,
      execPath: "node.exe",
      exit: (code) => {
        exitCode = code;
      },
    },
    console: { info() {}, error() {} },
  });
  return { calls, exitCode, originalEnv };
}

for (const command of ["dev", "build"]) {
  test(`Windows ${command} forwards arguments and applies compatibility to the child only`, () => {
    const args = [command, "--config", "path with spaces/config.json"];
    const { calls, exitCode, originalEnv } = runCommand("win32", args);
    assert.equal(calls[0].kind, "rustup");
    assert.equal(calls[1].args[0], "node.exe");
    assert.deepEqual(Array.from(calls[1].args[1]), [
      "tauri-cli-entry.js",
      ...args,
    ]);
    const env = calls[1].args[2].env;
    assert.equal(env.RUSTC, path.join("C:/Rust Stable", "bin", "rustc.exe"));
    assert.equal(
      env.RUSTDOC,
      path.join("C:/Rust Stable", "bin", "rustdoc.exe")
    );
    assert.equal(env.RUSTC_BOOTSTRAP, "1");
    assert.equal(env.RUSTUP_TOOLCHAIN, "nightly");
    assert.equal(env.KEEP, "existing");
    assert.equal(originalEnv.RUSTC, "old-compiler");
    assert.equal(exitCode, 0);
  });
}

test("other commands and platforms preserve their compiler environment", () => {
  for (const [platform, args] of [
    ["win32", ["--version"]],
    ["linux", ["dev"]],
    ["darwin", ["dev"]],
    ["linux", ["build"]],
    ["darwin", ["build"]],
  ]) {
    const { calls, exitCode } = runCommand(platform, args);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].kind, "cli");
    assert.equal(calls[0].args[2].env.RUSTC, "old-compiler");
    assert.equal(calls[0].args[2].env.RUSTC_BOOTSTRAP, undefined);
    assert.equal(exitCode, 0);
  }
});

test("compiler lookup failure stops before launching the CLI", () => {
  const { calls, exitCode } = runCommand("win32", ["dev"], {
    lookupFails: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(exitCode, 1);
});

test("the Tauri CLI exit code is preserved", () => {
  assert.equal(runCommand("win32", ["dev"], { status: 42 }).exitCode, 42);
});
