import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { startStack } from '../../scripts/local-stack.mjs';

export const STATE = '.e2e/stack.json';

/** Starts the throwaway stack for the run; the function it returns stops it and deletes what it wrote. */
export default async function globalSetup() {
  const stack = await startStack({ quiet: !process.env.STACK_VERBOSE });
  mkdirSync('.e2e', { recursive: true });
  writeFileSync(STATE, JSON.stringify({ apiBase: stack.apiBase, admin: stack.admin, logPath: stack.logPath }));
  return async () => {
    await stack.stop();
    rmSync('.e2e', { recursive: true, force: true });
  };
}
