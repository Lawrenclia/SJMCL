const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

// Some Windows workspace filesystems return EISDIR instead of EINVAL when
// readlink targets an ordinary file or directory. Next.js expects EINVAL.
function normalizeReadlinkError(error) {
  if (error.code === "EISDIR") {
    try {
      if (!fs.lstatSync(error.path).isSymbolicLink()) error.code = "EINVAL";
    } catch {
      // Preserve the original error when the path cannot be inspected.
    }
  }
  return error;
}

if (require.main === module) {
  const result = spawnSync(
    process.execPath,
    [require.resolve("next/dist/bin/next"), ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: [
          process.env.NODE_OPTIONS,
          `--require="${__filename.replace(/\\/g, "/")}"`,
        ]
          .filter(Boolean)
          .join(" "),
      },
    }
  );
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
} else {
  const readlink = fs.readlink;
  fs.readlink = (path, ...args) => {
    const callback = args.pop();
    readlink(path, ...args, (error, link) => {
      callback(error ? normalizeReadlinkError(error) : null, link);
    });
  };

  const readlinkSync = fs.readlinkSync;
  fs.readlinkSync = (...args) => {
    try {
      return readlinkSync(...args);
    } catch (error) {
      throw normalizeReadlinkError(error);
    }
  };

  const readlinkAsync = fs.promises.readlink;
  fs.promises.readlink = async (...args) => {
    try {
      return await readlinkAsync(...args);
    } catch (error) {
      throw normalizeReadlinkError(error);
    }
  };
  syncBuiltinESMExports();
}
