# stonetape 📼

> **Stonetape turns real LLM and tool interactions into hermetic regression tests for TypeScript applications.**

[![npm](https://img.shields.io/npm/v/stonetape?style=flat-square&color=d43d2a&labelColor=1a1611)](https://www.npmjs.com/package/stonetape)
[![license](https://img.shields.io/badge/license-MIT-d43d2a?style=flat-square&labelColor=1a1611)](LICENSE)
[![stonetape.dev](https://img.shields.io/badge/%E2%96%B6%20PLAY-stonetape.dev-d43d2a?style=flat-square&labelColor=1a1611)](https://stonetape.dev)

![stonetape demo](assets/demo.gif)

```text
CI BEFORE                          CI AFTER
4 MIN · $3.00          ▶▶          2 SEC · $0.00
```

Record a real agent run once. Replay it in CI forever: zero tokens, zero flakiness, no API keys, fully parallel.

**Mocks test scenarios you imagined. Stonetape preserves the messy ones that actually happened.**

*Named after the [Stone Tape Theory](https://en.wikipedia.org/wiki/Stone_Tape): the idea that places record events and replay them, endlessly, like magnetic tape.*

## Status

🚧 **Alpha under active development.** Falsification sprint in progress. API may change before 0.1.

## Quick start

```bash
npm install stonetape@alpha
```

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

## Why stonetape

Real situations this solves:

1. **Your CI hits real APIs.** Tests cost money per push, run serialized "to keep spend down," carry `retry: 1` because live hops blip, and engineers re-run red builds until they pass. With cassettes: $0, fully parallel, deterministic. Red means regression again.
2. **Your mock is lying.** A hand-written mock returns the response you *imagined*. The real model returns `content: null` plus two tool calls with escaped-JSON arguments, and your parser chokes on exactly that. Cassettes preserve the messy payload that actually happened.
3. **Silent agent-chain breaks.** A refactor drops the tool result from the conversation. The agent *still answers*, because LLMs paper over missing context, so demos pass while the model quietly hallucinates without its data. Strict chain replay fails instantly: `at messages.2: recorded: {role:"tool",…} / incoming: (missing)`.
4. **Refactor paralysis.** SDK migrations, model swaps, prompt-builder rewrites: today verified by eyeballing outputs. Replay pins the *request side* too: dropped system prompts, reordered messages, changed `tool_choice` all fail with field-level diffs.
5. **Contributors without keys.** `skipIf(!API_KEY)` means forks, new hires, and fork CI get zero LLM-path coverage. Cassettes live in the repo; everyone replays the full suite offline.
6. **Unreproducible streaming bugs.** That one tool call split across two SSE chunks at the worst boundary? The cassette replays the exact chunk sequence, forever.
7. **"Did my prompt change break anything else?"** *(roadmap)* Re-record and see the blast radius as a reviewable diff: "3 of 42 cassettes changed. Here is what the model does differently."

## The mock that lies

*A real example, from a real cassette.*

`tests/demo1-mock-vs-cassette.test.ts` runs the same agent code under a hand-written mock and under a stonetape cassette recorded from the live API. The app has two bugs that are everywhere in the wild:

- **Bug A:** `message.content.trim()`, but on tool-call turns the real API sends `content: null`
- **Bug B:** treating `tool_call.function.arguments` as an object; the real API sends a JSON *string*

Scorecard, measured:

| | Hand-written mock | stonetape cassette |
|---|---|---|
| Setup | ~35 lines of imagined response | 1 recording run (`$0.0003`) |
| Bug A (`content: null`) | ✅ passes, **ships to prod** | 💥 caught: real `TypeError` in CI |
| Bug B (lost tool argument) | ✅ passes, mocks never validate what you *send* | 💥 caught: `Expected call: 2 of 2`, diff names the lost `"city":"Cluj"` |
| Correct implementation | ✅ passes | ✅ passes, offline, 4ms |
| Maintenance | drifts from reality forever | re-record with one command |

The second row of Bug B is the underrated half: a mock answers *any* conversation you send it, however broken. A cassette pins the request side too.

## What stonetape does

- **Records** real LLM interactions (requests, responses, tool-call chains, streaming chunks) into human-readable YAML cassettes you commit and review in PRs.
- **Replays** them deterministically. **Fail-closed:** in replay mode, no unrecorded network call ever escapes. Unmatched requests fail with an explanation of exactly what differed, including chain position ("expected call 2 of 3"). Swallowed errors don't hide: if your app's fallback layer catches a mismatch, the vitest helper re-raises it on teardown.
- **Understands agent chains.** `order: "strict"` (default) catches reordered, duplicated, and drifted calls. Apps with fire-and-forget side calls declare them: `order: { mode: "strict", concurrent: ["/telemetry"] }`. The main chain stays guarded while detached calls match anywhere.
- **Redacts** known secret shapes (auth headers, API-key patterns) before anything touches disk, plus safety checks. Don't rely on it blindly for PII.

## What stonetape does not do

- It does **not** test model quality. A cassette proves your app still handles previously recorded behavior; it doesn't prove the live model behaves well today. Use evals for that (they're complementary).
- It is **not** an LLM cache. Caches save money at runtime; stonetape gives you versioned test artifacts, offline determinism, and reviewable behavior diffs.
- It does not magically reproduce every agent. Side-effectful tools are replayed, not re-executed.

## vs. the alternatives

| | Hand-written / official mocks (`MockLanguageModelV4`) | Generic VCR (vcrpy, Polly.JS) | stonetape |
|---|---|---|---|
| Response shape | what you imagined | real | real |
| Tool-call chains | manual, brittle | not understood | first-class |
| LLM streaming | manual simulation | fragile | recorded chunks |
| Volatile prompt fields | n/a | strict-match explosions | declarative ignores |
| Mismatch UX | n/a | generic error | explains what changed, where in the chain |

## Process-level recording: `stonetape proxy`

When the LLM traffic isn't in your test process — agent CLIs, sidecar services, polyglot systems — run stonetape as a recording/replaying reverse proxy and point the process at it via its base-URL env. Works for any language; no TLS tricks, no code changes:

```bash
# record once (real upstream):
stonetape proxy --cassette agent.yaml --target https://api.openai.com --mode record
OPENAI_BASE_URL=http://127.0.0.1:<port>/v1  your-agent-cli "do the thing"
# Ctrl-C writes the cassette

# replay forever (upstream not contacted, no keys):
stonetape proxy --cassette agent.yaml --target https://api.openai.com --port 8787
OPENAI_BASE_URL=http://127.0.0.1:8787/v1  your-agent-cli "do the thing"
```

Same engine as the in-process transport: identical matching, ordering, redaction, and fail-closed semantics — unrecorded requests answer `501` with the full mismatch explanation. For apps using bare global `fetch` in-process, there's also `tape.install()` (patches and restores `globalThis.fetch`).

## License

MIT

```text
■ STOP · END OF TAPE
```
