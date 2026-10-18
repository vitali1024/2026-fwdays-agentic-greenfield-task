import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// GHSA-qx66-fv34-fjm8: check every lock entry, including nested copies.
test("all locked TanStack Start packages meet the XSS advisory patched floors", () => {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    packages: Record<string, { version?: string }>;
  };
  const floors: Record<string, number[]> = {
    "@tanstack/react-start": [1, 168, 60],
    "@tanstack/start-server-core": [1, 169, 39],
    "@tanstack/solid-start": [1, 168, 57],
    "@tanstack/vue-start": [1, 168, 56],
  };
  for (const required of ["@tanstack/react-start", "@tanstack/start-server-core"]) {
    assert.ok(lock.packages[`node_modules/${required}`], `Missing ${required}`);
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    for (const [name, floor] of Object.entries(floors)) {
      if (path !== `node_modules/${name}` && !path.endsWith(`/node_modules/${name}`)) continue;
      assert.match(entry.version ?? "", /^\d+\.\d+\.\d+$/u, `${path} must use a stable release`);
      const version = entry.version!.split(".").map(Number);
      const difference =
        version.map((part, index) => part - floor[index]!).find((part) => part !== 0) ?? 0;
      assert.ok(difference >= 0, `${path}@${entry.version} is below the patched floor`);
    }
  }
});
