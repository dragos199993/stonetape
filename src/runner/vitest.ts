/**
 * Vitest integration — `import { cassette } from "stonetape/vitest"`.
 *
 * v0.1 keeps it explicit and dependency-free: the helper opens a tape named
 * after the test, hands you the fetch, and guarantees close() on teardown.
 */
import { join } from "node:path";
import { type Tape, type TapeOptions, openCassette } from "../index.js";

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
    try {
      await fn({ tape, fetch: tape.fetch });
    } finally {
      tape.close();
    }
  };
}
