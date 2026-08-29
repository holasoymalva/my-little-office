import { runShell } from '../agent/tools.ts';
import type { ProjectConfig } from '../types.ts';

export type VerifyResult = {
  passed: boolean;
  command?: string;
  output?: string;
};

/**
 * Runs the project's own definition of "this change works". A task is never
 * delivered on a failing check.
 */
export async function verifyProject(options: {
  dir: string;
  project: ProjectConfig;
  timeoutMs: number;
  onLog: (message: string, detail?: string) => void;
}): Promise<VerifyResult> {
  const { dir, project, timeoutMs, onLog } = options;

  if (!project.verify.length) {
    onLog('No verify commands configured for this project — skipping.');
    return { passed: true };
  }

  for (const command of project.verify) {
    onLog(`Verifying: ${command}`);
    const result = await runShell(command, { cwd: dir, timeoutMs });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

    if (result.code !== 0) {
      onLog(`Failed: ${command}`, output.slice(-4000));
      return { passed: false, command, output: output.slice(-8000) };
    }
    onLog(`Passed: ${command}`);
  }

  return { passed: true };
}
