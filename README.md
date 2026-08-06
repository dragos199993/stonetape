# stonetape 📼👻

> **Record once. Replay forever.** Deterministic tests for LLM apps.

*Named after the [Stone Tape Theory](https://en.wikipedia.org/wiki/Stone_Tape) — the idea that places record events and replay them, endlessly, like magnetic tape. Your LLM calls, recorded once — haunting your CI forever (in a good way).*

## Status

⚠️ **v0.0.1 is a name reservation.** v0.1 is under active development.

## What it will do

```ts
import { cassette } from "stonetape/vitest";

test("refund agent issues refund", cassette("support/refund-flow"), async () => {
  const outcome = await runAgent("I want a refund on order #4411");
  expect(outcome.action).toBe("refund_issued");
});
```

```bash
STONETAPE_MODE=record vitest   # hits the real API once, writes the cassette
vitest                         # replays forever: $0, 0 flakes, no API keys in CI
```

- **Record real LLM interactions** (OpenAI, Anthropic, Vercel AI SDK) — requests, responses, tool calls, and streaming chunks, faithfully.
- **Replay deterministically** in CI: zero tokens, zero flakiness, full parallelism, no secrets.
- **Smart matching** — ignore volatile prompt fields (timestamps, IDs) declaratively instead of watching strict matching explode.
- **Agent sessions** — cassettes capture whole chains (LLM → tool call → LLM → …) and fail with an explicit chain diff when behavior changes.
- **Secret redaction** by default — cassettes are safe to commit.
- **Behavior diffs on re-record** — prompt changes become reviewable in PRs.

## Why not just…

- **vcrpy / Polly.JS?** Generic HTTP recorders don't understand LLM streaming, volatile prompt fields, tool-call sessions, or produce behavior diffs.
- **Provider prompt caching / proxy caches?** A cache saves money; it doesn't give you offline determinism, versioned test artifacts, or a reviewable diff of model behavior.
- **Hand-written mocks?** They lie. Recorded cassettes have the real shape, the real edge cases, the real streaming chunks.

## Follow along

- Site: [stonetape.dev](https://stonetape.dev)
- Repo: [github.com/stonetape-dev/stonetape](https://github.com/stonetape-dev/stonetape)

## License

MIT
