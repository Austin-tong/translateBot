import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(import.meta.dirname, "bootstrap-local.sh");

describe("bootstrap-local.sh", () => {
  it("uses reproducible install, forwards args, and execs the proxy", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain("npm ci");
    expect(script).toContain("./node_modules/.bin/tsx scripts/setup-local.ts --yes \"$@\"");
    expect(script).toContain("exec npm run dev:proxy");
  });
});
