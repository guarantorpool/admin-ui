export interface Mail { to: string; subject: string; body: string }
export interface Stack {
  apiBase: string;
  apiPort: number;
  admin: { email: string; password: string };
  logPath: string;
  dir: string;
  /** the throwaway Postgres container, for tests that stand in for an outside service */
  dbContainer: string;
  /** the chain stand-in; POST /safes registers a Safe it answers for */
  chainUrl: string;
  /** the stand-in Lipa na BLOCKS: who signs passes, the origin its page runs on, and its signing key (PEM) */
  lnb: { issuer: string; origin: string; kid: string; key: string };
  stop(): Promise<void>;
}
export function docker(...args: string[]): string;
export function startChain(opts?: { jwks?: unknown }): Promise<{ url: string; close(): Promise<void> }>;
export function startStack(opts?: { quiet?: boolean }): Promise<Stack>;
export function readMails(logPath: string): Mail[];
export function waitForMail(logPath: string, to: string, subject: RegExp, opts?: { skip?: number; timeoutMs?: number }): Promise<Mail>;
export function loginCode(mail: Mail): string | undefined;
export function resetCode(mail: Mail): string | undefined;
export function linkIn(mail: Mail, route: string): string | undefined;
