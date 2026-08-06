#!/usr/bin/env node
/**
 * stonetape CLI.
 * v0.1 surface: `stonetape review` (cassette change review) is the product
 * moment — this stub reserves the command shape; implementation lands next.
 */
const [, , command] = process.argv;

switch (command) {
  case "review":
    console.log(
      "stonetape review — coming in v0.1:\n" +
        "  · list cassettes changed on this branch\n" +
        "  · show behavior diffs (chain-level for agent sessions)\n" +
        "  · approve per cassette or all\n",
    );
    break;
  case "--version":
  case "-v":
    console.log("stonetape 0.1.0-dev.0");
    break;
  default:
    console.log(
      "stonetape — Turn real agent runs into fast, hermetic regression tests.\n\n" +
        "Usage:\n" +
        "  stonetape review     review cassette changes\n" +
        "  stonetape --version  print version\n\n" +
        "Record: STONETAPE_MODE=record vitest\n" +
        "Replay: vitest\n",
    );
}
