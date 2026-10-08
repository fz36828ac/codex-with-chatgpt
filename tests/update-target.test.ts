import { describe, expect, it } from "vitest";
import { resolveUpdateTarget } from "../src/config/update-target.js";

function checkout(branch: string | null, remote?: string, merge?: string) {
  return (args: string[]) => {
    const value = args[0] === "symbolic-ref" ? branch : args.at(-1)?.endsWith(".remote") ? remote : merge;
    return { ok: Boolean(value), stdout: value ?? "" };
  };
}

describe("checkout update target", () => {
  it("keeps a hardened fork on its tracked fix branch rather than origin HEAD", () => {
    expect(resolveUpdateTarget(checkout("fix/workspace-read-security", "origin", "refs/heads/fix/workspace-read-security")))
      .toEqual({ remote: "origin", ref: "refs/heads/fix/workspace-read-security" });
  });
  it("respects a non-origin tracking remote and differently named branch", () => {
    expect(resolveUpdateTarget(checkout("local-fix", "reviewed", "refs/heads/release/security")))
      .toEqual({ remote: "reviewed", ref: "refs/heads/release/security" });
  });
  it("checks the same branch on origin for an untracked checkout", () => {
    expect(resolveUpdateTarget(checkout("main"))).toEqual({ remote: "origin", ref: "refs/heads/main" });
  });
  it("does not automatically update a pinned detached checkout", () => {
    expect(resolveUpdateTarget(checkout(null))).toBeNull();
  });
});
