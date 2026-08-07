#!/usr/bin/env node
/**
 * stonetape CLI.
 *
 * `stonetape diff <cassette>` — the inspection companion to the mismatch
 * error. Shows what a cassette contains, and (inside a git repo) how it
 * changed vs HEAD: which calls were added/removed/modified.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import type { Cassette, Interaction } from "../schema/cassette.js";
import { out, recDot } from "../ui/style.js";
import { startProxy } from "../proxy/server.js";
import type { Mode } from "../transport/fetch.js";

const [, , command, ...args] = process.argv;

switch (command) {
  case "proxy":
    void proxy(args);
    break;  case "diff":
    diff(args[0]);
    break;
  case "review":
    console.log(
      `stonetape review ${out.dim("(coming in v0.1)")}\n` +
        "  \u00b7 list cassettes changed on this branch\n" +
        "  \u00b7 show behavior diffs (chain-level for agent sessions)\n" +
        "  \u00b7 approve per cassette or all\n",
    );
    break;
  case "--version":
  case "-v":
    console.log("stonetape 0.1.0-alpha.4");
    break;
  default:
    console.log(
      `\n\ud83d\udcfc ${out.bold("stonetape")} ${out.dim("\u00b7 record once, replay forever")}\n\n` +
        "  stonetape proxy             process-level record/replay (any language)\n" +
        "  stonetape diff <cassette>   inspect a cassette / show changes vs git HEAD\n" +
        "  stonetape review            review cassette changes (coming soon)\n" +
        "  stonetape --version         print version\n\n" +
        `  ${recDot(out)} REC   ${out.dim("STONETAPE_MODE=record vitest")}\n` +
        `  \u25b6 PLAY  ${out.dim("vitest")}\n`,
    );
}

function diff(path: string | undefined): void {
  if (!path) {
    console.error("Usage: stonetape diff <cassette.yaml>");
    process.exit(1);
  }
  if (!existsSync(path)) {
    console.error(`No such cassette: ${path}`);
    process.exit(1);
  }
  const current = parse(readFileSync(path, "utf8")) as Cassette;

  console.log(`\n\ud83d\udcfc ${out.bold(path)}`);
  console.log(
    out.dim(
      `   recorded ${current.meta.updatedAt} \u00b7 stonetape ${current.recorder.version} \u00b7 ${current.interactions.length} calls`,
    ) + "\n",
  );

  const previous = gitHeadVersion(path);
  if (!previous) {
    printChain(current.interactions);
    return;
  }

  if (JSON.stringify(previous.interactions) === JSON.stringify(current.interactions)) {
    console.log("No changes vs git HEAD.\n");
    printChain(current.interactions);
    return;
  }

  console.log("Changes vs git HEAD:\n");
  const prevBySeq = new Map(previous.interactions.map((i) => [i.seq, i]));
  const currBySeq = new Map(current.interactions.map((i) => [i.seq, i]));
  const maxSeq = Math.max(
    ...previous.interactions.map((i) => i.seq),
    ...current.interactions.map((i) => i.seq),
  );
  for (let seq = 0; seq <= maxSeq; seq++) {
    const prev = prevBySeq.get(seq);
    const curr = currBySeq.get(seq);
    if (prev && !curr) console.log(out.red(`  - call ${seq + 1} removed   (${label(prev)})`));
    else if (!prev && curr) console.log(out.green(`  + call ${seq + 1} added     (${label(curr)})`));
    else if (prev && curr && prev.request.fingerprint !== curr.request.fingerprint)
      console.log(out.yellow(`  ~ call ${seq + 1} request changed  (${label(curr)})`));
    else if (
      prev &&
      curr &&
      JSON.stringify(prev.response) !== JSON.stringify(curr.response)
    )
      console.log(out.yellow(`  ~ call ${seq + 1} response changed (${label(curr)})`));
  }
  console.log();
}

function printChain(interactions: Interaction[]): void {
  for (const i of interactions) {
    console.log(
      `  ${String(i.seq + 1).padStart(2)}. ${label(i)}  ` +
        out.dim(`fp:${i.request.fingerprint.slice(0, 12)}  ${i.meta.recordedAt}`),
    );
  }
  console.log();
}

function label(i: Interaction): string {
  const kind = i.canonical ? [i.canonical.kind, i.canonical.model].filter(Boolean).join(" ") : "?";
  const url = new URL(i.request.url);
  const streaming = i.response.stream ? " [stream]" : "";
  return `${i.request.method} ${url.pathname} \u00b7 ${kind}${streaming}`;
}

function gitHeadVersion(path: string): Cassette | undefined {
  try {
    const raw = execFileSync("git", ["show", `HEAD:./${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parse(raw) as Cassette;
  } catch {
    return undefined;
  }
}

// ── stonetape proxy ─────────────────────────────────────────────────────────

async function proxy(argv: string[]): Promise<void> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) return proxyUsage();
    flags.set(key.slice(2), value);
  }
  const cassette = flags.get("cassette");
  const target = flags.get("target");
  if (!cassette || !target) return proxyUsage();

  const mode = (flags.get("mode") ?? process.env.STONETAPE_MODE ?? "replay") as Mode;
  const ignore = flags.get("ignore")?.split(",").filter(Boolean) ?? [];
  const orderFlag = flags.get("order") ?? "strict";

  const handle = await startProxy({
    cassette,
    target,
    mode,
    port: flags.has("port") ? Number(flags.get("port")) : 0,
    order: orderFlag === "any" ? "any" : "strict",
    match: { mode: "smart", ignore },
  });

  console.log(`stonetape proxy ${out.dim(`(${mode})`)}`);
  console.log(`  listening  ${handle.url}`);
  console.log(`  cassette   ${cassette}`);
  console.log(`  target     ${mode === "replay" ? out.dim(`${target} (not contacted)`) : target}`);
  console.log(`\nPoint your process at it, e.g.:`);
  console.log(out.dim(`  OPENAI_BASE_URL=${handle.url}/v1  your-command`));
  console.log(out.dim(`  ANTHROPIC_BASE_URL=${handle.url}  your-command`));
  console.log(`\nCtrl-C to stop${mode === "record" ? " (cassette is written on exit)" : ""}.`);

  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function proxyUsage(): void {
  console.log(
    `Usage: stonetape proxy --cassette <file> --target <base-url> [options]\n\n` +
      `  --mode record|replay|live   default: STONETAPE_MODE or replay\n` +
      `  --port <n>                  default: ephemeral\n` +
      `  --order strict|any          default: strict\n` +
      `  --ignore a,b.c              volatile body paths to ignore in matching\n\n` +
      `Record once:  stonetape proxy --cassette t.yaml --target https://api.openai.com --mode record\n` +
      `Replay in CI: stonetape proxy --cassette t.yaml --target https://api.openai.com --port 8787`,
  );
  process.exit(1);
}
