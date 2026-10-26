const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");

const args = process.argv.slice(2);
const env = { ...process.env };

try {
  if (
    process.platform === "win32" &&
    (args[0] === "dev" || args[0] === "build")
  ) {
    // Match local-check.ps1: the current nightly ICEs in azalea-entity.
    const sysroot = execFileSync(
      "rustup",
      ["run", "stable", "rustc", "--print", "sysroot"],
      { encoding: "utf8" }
    ).trim();
    env.RUSTC = path.join(sysroot, "bin", "rustc.exe");
    env.RUSTDOC = path.join(sysroot, "bin", "rustdoc.exe");
    env.RUSTC_BOOTSTRAP = "1";
    env.RUSTUP_TOOLCHAIN = "nightly";
    console.info(
      `[tauri ${args[0]}] Using stable Rust with the local nightly compatibility settings.`
    );
  }

  const result = spawnSync(
    process.execPath,
    [require.resolve("@tauri-apps/cli/tauri.js"), ...args],
    { stdio: "inherit", env }
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
