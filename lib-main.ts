// The entry <-> env lifecycle, restructured into small, independently readable helpers.
// app.ts owns the HTTP surface; this module owns only the handshake with the env: bind an
// ephemeral port, announce it, and wait until the env declares the trial finished.
// No packages and no Node built-ins are imported: the local server is the only dependency.

import { createApp } from './app.ts';

/** Longest a single register or done request may run before it is dropped and retried. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Pause before the first retry; it doubles on each failure. */
const RETRY_INITIAL_MS = 250;
/** Ceiling the exponential pause grows up to. */
const RETRY_MAX_MS = 2_000;
/** Largest exponent used by the backoff, keeping 2 ** exponent modest. */
const MAX_BACKOFF_EXPONENT = 8;
/** Marker distinguishing a fatal register reply from a retryable transport error. */
const REGISTER_ERROR_PREFIX = 'register answered HTTP ';

/** Drop any trailing slashes so an endpoint can be appended with exactly one '/'. */
function normalizeEnvOrigin(raw: string | undefined): string {
  return (raw ?? '').replace(/\/+$/, '');
}

/** Read the env origin, or terminate with status 1 when there is no env to contact. */
function requireEnvOrigin(): string {
  const origin = normalizeEnvOrigin(process.env.MAKEFUN_ENV_URL);
  if (origin === '') {
    process.stderr.write('[entry] MAKEFUN_ENV_URL is not set: there is no env to register with\n');
    process.exit(1);
  }
  return origin;
}

/** Promise-based timer used between unsuccessful attempts. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential wait after `attempt` failures, capped at RETRY_MAX_MS. */
function retryDelay(attempt: number): number {
  const exponent = Math.min(attempt, MAX_BACKOFF_EXPONENT);
  return Math.min(RETRY_MAX_MS, RETRY_INITIAL_MS * 2 ** exponent);
}

/** Build the fatal error for a register reply that breaks the contract (400 / 405). */
function registerContractError(status: number, detail: string): Error {
  return new Error(`${REGISTER_ERROR_PREFIX}${status}: ${detail}`);
}

/**
 * POST the bound port until the env accepts it. 200 is the normal reply; 409 only means an earlier
 * registration won and this process still waits on the same trial. 400 and 405 are fatal contract
 * errors; transport failures and other statuses are retried while the env may still be booting.
 */
async function announcePort(origin: string, port: number): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const reply = await fetch(`${origin}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (reply.status === 200 || reply.status === 409) return;
      if (reply.status === 400 || reply.status === 405) {
        throw registerContractError(reply.status, await reply.text());
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(REGISTER_ERROR_PREFIX)) throw error;
    }
    await delay(retryDelay(attempt));
  }
}

/** Poll GET /done until the answer is {"done":true}; never return any sooner. */
async function awaitCompletion(origin: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const reply = await fetch(`${origin}/done`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (reply.ok) {
        const payload = (await reply.json()) as { done?: unknown };
        if (payload.done === true) return;
      }
    } catch {
      // The env is not answering yet or the poll expired: not done, so ask again.
    }
    await delay(retryDelay(attempt));
  }
}

/** Start the app on a kernel-chosen port and hand back the server together with that port. */
async function bindEphemeralPort() {
  const server = createApp();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server did not bind an ephemeral TCP port');
  }
  return { server, port: address.port };
}

/** One full session: bind, register, wait for done, then shut the server down. */
async function runLifecycle(origin: string): Promise<void> {
  const { server, port } = await bindEphemeralPort();
  process.stdout.write(`[entry] listening on port ${port}\n`);

  await announcePort(origin, port);
  process.stdout.write('[entry] registered; waiting for the env to say done\n');

  await awaitCompletion(origin);
  server.close();
  process.stdout.write('[entry] done\n');
}

/** Fatal errors use the same [entry] prefix as the progress messages, but on stderr. */
function reportFailure(error: unknown): void {
  process.stderr.write(`[entry] ${error instanceof Error ? error.message : String(error)}\n`);
}

/** Entry point for main.ts: validate the env, run the session, and choose the exit status. */
export async function main(): Promise<void> {
  const origin = requireEnvOrigin();
  try {
    await runLifecycle(origin);
    process.exit(0);
  } catch (error) {
    reportFailure(error);
    process.exit(1);
  }
}
