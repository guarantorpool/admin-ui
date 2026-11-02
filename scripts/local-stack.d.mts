export interface Mail { to: string; subject: string; body: string }
export interface Stack {
  apiBase: string;
  apiPort: number;
  admin: { email: string; password: string };
  logPath: string;
  dir: string;
  stop(): Promise<void>;
}
export function startStack(opts?: { quiet?: boolean }): Promise<Stack>;
export function readMails(logPath: string): Mail[];
export function waitForMail(logPath: string, to: string, subject: RegExp, opts?: { skip?: number; timeoutMs?: number }): Promise<Mail>;
export function loginCode(mail: Mail): string | undefined;
export function linkIn(mail: Mail, route: string): string | undefined;
