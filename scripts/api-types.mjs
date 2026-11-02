// Regenerates src/api/schema.d.ts from the backend's OpenAPI document, so a renamed field breaks the
// type check instead of a screen.
//   npm run api:types            reads it from the backend at VITE_API_BASE_URL (SWAGGER_ENABLED=true)
//   npm run api:types -- --file  regenerates from the copy saved in openapi/gp-api.json
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { loadEnv } from 'vite';

const SPEC = 'openapi/gp-api.json';
const OUT = 'src/api/schema.d.ts';

if (!process.argv.includes('--file')) {
  const env = loadEnv('development', process.cwd(), 'VITE_');
  const base = env.VITE_API_BASE_URL || 'http://localhost:8080/api';
  // springdoc serves the document at the server root, outside /api
  const url = new URL('/v3/api-docs', base).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}. Is the backend running with SWAGGER_ENABLED=true?`);
  const spec = await res.json();
  delete spec.servers; // the address it was read from, not part of the contract
  await writeFile(SPEC, JSON.stringify(spec, null, 2) + '\n');
  console.log(`Saved ${SPEC} from ${url}`);
}

JSON.parse(await readFile(SPEC, 'utf8'));
execFileSync(process.execPath, ['node_modules/openapi-typescript/bin/cli.js', SPEC, '-o', OUT], { stdio: 'inherit' });
