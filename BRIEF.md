# Stonetape — Project Brief for External Review

## What we're building

**Stonetape** (`npm install stonetape` · stonetape.dev) — "VCR for LLM apps": a TypeScript-first open-source library that records real LLM API interactions once (requests, responses, tool calls, streaming chunks) into versioned "cassette" files, then replays them deterministically in tests/CI. Zero tokens spent, zero flaky tests, no API keys needed in CI.

Tagline: *Record once. Replay forever. Deterministic tests for LLM apps.*
Name origin: the "Stone Tape Theory" — places record events and replay them like magnetic tape.

## The problem

Teams with LLM code in production have three bad options for testing:
1. Hit real APIs in CI → costs real money, slow, flaky (rate limits, non-determinism), needs secrets everywhere
2. Hand-written mocks → drift from reality, silently lie when providers change response shapes
3. Skip LLM-path tests entirely → most common

Note: even `temperature=0` + `seed` is not deterministic (provider-side batching, floating point, silent model updates). Determinism cannot come from the API — only from not hitting it.

## Product design (v0.1 scope)

- Interception at the fetch layer — elegant in TS: OpenAI/Anthropic SDKs accept a custom `fetch`; Vercel AI SDK has an official middleware API. No monkeypatching.
- Cassettes: YAML/JSON files, language-agnostic versioned schema (so a future Python port replays the same cassettes), committed to git, secrets auto-redacted.
- Matching modes: `strict` (exact), `smart` (declaratively ignore volatile prompt fields like timestamps/UUIDs), later `semantic`. Mismatches produce explanations ("your prompt differs here"), not cryptic errors.
- Agent sessions: cassettes capture whole chains (LLM → tool call → LLM → …); behavioral changes fail with an explicit chain diff.
- Streaming: SSE chunks replayed faithfully.
- Test-runner integration: vitest/jest/bun first. `STONETAPE_MODE=record` to (re)record.

## Business model (Codecov playbook)

- OSS core: MIT, free forever (distribution channel)
- Paid cloud (later, only if validated): cassette storage, behavior-diff comments on PRs ("3 of 42 cassettes changed — here's what your prompt change did"), team history, nightly re-record + drift alarms. ~$19–29/dev/month.
- The strategic bet: the library is a feature; the *reviewable conversation about model behavior changes on PRs* is the business.

## Due diligence done (verified, not assumed)

- **No established identical solution exists.** LLM-specific attempts: vcr-langchain (82★, abandoned 2024, LangChain-only), openai-responses (55★, mock-first, OpenAI-only), plus ~8 toy projects ALL from the last 6 months (AgentTape 4★, two different "llmtape"s, three different "cassette"s, all ≤4★). Signal: the idea is "in the air," the race has started, nobody has executed.
- **Generic incumbents:** vcrpy (3k★) + pytest-recording (615★) are alive and "good enough" for simple Python cases → Python is harder to win. Polly.JS (10k★, Netflix) is semi-abandoned (last push May 2025) → the TS niche has a dying incumbent. This drove the TS-first decision.
- **Adjacent feature risk confirmed:** Braintrust AI Proxy has caching (seed-activated, encrypted, TTL). LangChain has SQLiteCache; promptfoo caches evals. All are *runtime caches for cost*, not versioned test artifacts with offline determinism and behavior diffs — but the positioning must make this distinction brutally clear, and a big player could add replay as a feature.
- **Founder-side validation:** the founder's employer's own repo (a TS proxy for Claude Code) documents the exact pain in code comments: e2e tests serialized because parallel runs "inflate model spend", `retry: 1` because "live Bedrock hops can blip", 3-minute test timeouts, tests skipped without staging credentials, and a hand-rolled mock universe (`mock-cloud.ts`) — i.e., teams already pay for this product in engineering hours.

## Honest risk assessment

1. **Feature-not-company (top risk):** may end up a 3k★ library with $0 MRR. Mitigation: cloud waitlist from day 1; don't build cloud until there's payment signal. Kill criteria: 6 months of OSS traction with zero payment signal → reclassify as a reputation asset, consciously.
2. **Big players absorb it:** Braintrust/LangSmith could ship replay in a sprint. Defense: speed + becoming the neutral OSS standard (the vcrpy position — neutral tools survive next to platforms). Also: features get acquired.
3. **Race timing:** 8 toy competitors appeared in 6 months. Window is ~12 months to become the default. Founder's edge: distribution (X/HN audience in the AI space) + daily dogfooding at work.
4. **Willingness to pay unknown** — this is the core open question.
5. Realistic outcome distribution (self-assessed): ~40% stays an OSS library with reputation value only; ~25% indie tool at $5–30k MRR; ~25% absorbed/acquired by an evals platform; ~10% becomes the standard and grows into a bigger "trust layer" company (replay → visual diffs of agent-built UIs → signed evidence trails for regulated industries).
6. This is deliberately an **indie-scale bet, not a venture-scale one.** Founder explicitly wants: low-touch, self-serve, global SaaS; no sales calls, no cold outreach, no public persona. Devtools OSS + PLG cloud fits all constraints.

## Founder context

- ~8 years software engineering, works on AI products at an AI company (conflict-of-interest zone: model routing/selection/cross-model cost optimization — Stonetape deliberately avoids it and would actually be a *consumer-side testing tool*, no overlap).
- Distribution assets: X + LinkedIn presence in the AI space, HN-capable. TypeScript daily driver.
- Alternative idea explored in depth and parked: an independent energy-advisor service for Romanian solar prosumers (validated market motion, but trust/persona-driven, RO-only ceiling, conflicts with founder's no-public-face constraint). Archived with a "validate first" verdict; Stonetape won on founder-fit.

## Current status (as of today)

- ✅ Name chosen and secured: `stonetape` published on npm as 0.0.1 placeholder (honest stub API + README with positioning)
- ✅ stonetape.dev registered (.io/.sh deferred)
- ✅ PyPI name still free (reservation pending), crates.io taken (irrelevant for now)
- ⏳ GitHub: decided to start under founder's personal namespace (reputation compounding, lossless transfer to an org later)
- ⏳ Next build steps: repo skeleton — fetch interceptor, versioned cassette schema, vitest plugin, README with "vs vcrpy / vs proxy caching" sections; then landing page with cloud waitlist; then Show HN with a demo GIF ("CI: 4 min & $3 → 2 sec & $0")
- 📋 Pre-code TODO: 15-min manual check of Braintrust/LangSmith docs to confirm no hidden deterministic-replay feature (search-engine checks found none, but rate limits prevented full confirmation)

## Questions we'd like a second opinion on

1. Is "deterministic replay for LLM tests" a real, durable category — or a transitional need that disappears as models/agents mature?
2. Is the TS-first call right, given vcrpy's strength in Python and Polly.JS's abandonment in JS?
3. Is the Codecov-style monetization line (free local library / paid PR-diff collaboration) the right cut, or is there a better one?
4. What would make the 8 toy competitors or a funded evals platform win instead?
5. Any failure modes we haven't listed?
