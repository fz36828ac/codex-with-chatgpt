type GitResult = { ok: boolean; stdout: string };
type GitRunner = (args: string[]) => GitResult;

/** Follow this checkout's tracking branch, never a fork's unrelated default branch. */
export function resolveUpdateTarget(runGit: GitRunner): { remote: string; ref: string } | null {
  const branch = runGit(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (!branch.ok || !branch.stdout) return null; // pinned/detached installations stay pinned
  const remote = runGit(["config", "--get", `branch.${branch.stdout}.remote`]);
  const merge = runGit(["config", "--get", `branch.${branch.stdout}.merge`]);
  if (remote.ok && remote.stdout && merge.ok && merge.stdout.startsWith("refs/heads/")) {
    return { remote: remote.stdout, ref: merge.stdout };
  }
  return { remote: "origin", ref: `refs/heads/${branch.stdout}` };
}
