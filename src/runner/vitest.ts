/**
 * Vitest integration — `import { cassette } from "stonetape/vitest"`.
 *
 * v0.1 keeps it explicit and dependency-free: the helper opens a tape named
 * after the test, hands you the fetch, and guarantees close() on teardown.
 */
import { join } from "node:path";
import { StonetapeReplayError, type Tape, type TapeOptions, openCassette } from "../index.js";

export interface CassetteContext {
  tape: Tape;
  /** Shorthand: fetch to inject into SDK clients. */
  fetch: typeof fetch;
}

/**
 * Wrap a test body with a cassette.
 *
 *   test("refund agent", cassette("support/refund-flow", async ({ fetch }) => {
 *     const client = new OpenAI({ fetch });
 *     ...
 *   }));
 *
 * Cassettes live under `cassettes/` at the project root by default.
 */
export function cassette(
  name: string,
  fn: (ctx: CassetteContext) => Promise<void> | void,
  options: TapeOptions & { dir?: string } = {},
): () => Promise<void> {
  return async () => {
    const path = join(options.dir ?? "cassettes", `${name}.yaml`);
    const tape = openCassette(path, options);
    let testError: unknown;
    try {
      await fn({ tape, fetch: tape.fetch });
    } catch (err) {
      testError = err;
      throw err;
    } finally {
      tape.close();
      // Resilient apps (fallback/retry layers) swallow replay errors — the
      // test body then completes "successfully" while the cassette knows
      // better. Surface the swallowed mismatch. (github issue #1)
      if (testError === undefined && tape.mismatches.length > 0) {
        const first = tape.mismatches[0]!;
        // eslint-disable-next-line no-unsafe-finally
        throw new StonetapeReplayError(
          `${first.message}\n\n` +
            `(note: the application swallowed this error — a resilience/fallback ` +
            `layer caught it before the test could see it. ${tape.mismatches.length} ` +
            `mismatch(es) total in this tape.)`,
        );
      }
    }
  };
}
