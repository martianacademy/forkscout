// src/tools/git_operations_tools.ts — Git operations: status, commit, push, pull, log, branch
import { tool } from "ai";
import { z } from "zod";

export const IS_BOOTSTRAP_TOOL = false;

export const git_operations_tools = tool({
  description: "Run git commands: status, commit, push, pull, log, branch, diff, stash. Useful for version control operations.",
  inputSchema: z.object({
    command: z.enum(["status", "commit", "push", "pull", "log", "branch", "diff", "stash", "fetch"]).describe("Git subcommand to run"),
    args: z.array(z.string()).optional().describe("Additional arguments for the git command"),
    message: z.string().optional().describe("Commit message (for commit command)"),
    remote: z.string().optional().describe("Remote name (default: origin)"),
    branch: z.string().optional().describe("Branch name (for branch, push, pull commands)")
  }),
  execute: async (input) => {
    try {
      let cmd = `git ${input.command}`;
      
      if (input.command === "commit" && input.message) {
        cmd += ` -m "${input.message}"`;
      } else if (input.command === "push" && input.remote) {
        cmd += ` ${input.remote}`;
        if (input.branch) cmd += ` ${input.branch}`;
      } else if (input.command === "pull" && input.remote) {
        cmd += ` ${input.remote}`;
        if (input.branch) cmd += ` ${input.branch}`;
      } else if (input.command === "branch" && input.branch) {
        cmd += ` -D ${input.branch}`;
      }
      
      if (input.args && input.args.length > 0) {
        cmd += ` ${input.args.join(" ")}`;
      }

      const { completed, stdout, stderr } = await Bun.spawnAsync(["sh", "-c", cmd], { cwd: process.cwd() });
      
      if (completed.signal) {
        return { success: false, error: `Process killed by signal: ${completed.signal}` };
      }
      
      return {
        success: true,
        command: cmd,
        stdout: stdout || "(no output)",
        stderr: stderr || "(no error)",
        exitCode: completed.exitCode
      };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
});
