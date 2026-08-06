# stonetape 📼

> **Stonetape turns real LLM and tool interactions into hermetic regression tests for TypeScript applications.**

Record a real agent run once. Replay it in CI forever: zero tokens, zero flakiness, no API keys, fully parallel.

**Mocks test scenarios you imagined. Stonetape preserves the messy ones that actually happened.**

*Named after the [Stone Tape Theory](https://en.wikipedia.org/wiki/Stone_Tape) — the idea that places record events and replay them, endlessly, like magnetic tape.*

## Status

🚧 **Alpha under active development** — falsification sprint in progress. API may change before 0.1.

## Quick start

```ts
import { openCassette } from "stonetape";
import OpenAI from "openai";

const tape = openCassette("tests/cassettes/weather-agent.yaml");
const client = new OpenAI({ fetch: tape.fetch });

// ... run your agent ...

tape.close();
```

```bash
STONETAPE_MODE=record vitest   # hits the real API once, writes the cassette
vitest                         # replays forever: no network, no keys, deterministic
```

With the vitest helper:

```ts
import { cassette } from "stonetape/vitest";

test("weather agent", cassette("weather-agent", async ({ fetch }) => {
  const client = new OpenAI({ fetch });
  const result = await runAgent(client, "What's the weather in Cluj?");
  expect(result.city).toBe("Cluj");
}));
```

## What stonetape does

- **Records** real LLM interactions — requests, responses, tool-call chains, streaming chunks — into human-readable YAML cassettes you commit and review in PRs.
- **Replays** them deterministically. **Fail-closed:** in replay mode, no unrecorded network call ever escapes. Unmatched requests fail with an explanation of exactly what differed — including chain position ("expected call 2 of 3").
- **Redacts** known secret shapes (auth headers, API-key patterns) before anything touches disk — plus safety checks. Don't rely on it blindly for PII.

## What stonetape does NOT do

- It does **not** test model quality — a cassette proves your app still handles previously recorded behavior; it doesn't prove the live model behaves well today. Use evals for that (they're complementary).
- It is **not** an LLM cache — caches save money at runtime; stonetape gives you versioned test artifacts, offline determinism, and reviewable behavior diffs.
- It does not magically reproduce every agent — side-effectful tools are replayed, not re-executed.

## vs. the alternatives

| | Hand-written / official mocks (`MockLanguageModelV4`) | Generic VCR (vcrpy, Polly.JS) | stonetape |
|---|---|---|---|
| Response shape | what you imagined | real | real |
| Tool-call chains | manual, brittle | not understood | first-class |
| LLM streaming | manual simulation | fragile | recorded chunks |
| Volatile prompt fields | n/a | strict-match explosions | declarative ignores |
| Mismatch UX | n/a | generic error | explains what changed, where in the chain |

## License

MIT
