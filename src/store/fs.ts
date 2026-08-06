/**
 * Cassette file store — YAML on disk.
 *
 * YAML is a product decision, not a technical one: cassettes are meant to be
 * read by humans in pull-request diffs. That's where behavior review happens.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import { type Cassette, assertCompatible, emptyCassette } from "../schema/cassette.js";

export function loadCassette(path: string): Cassette | undefined {
  if (!existsSync(path)) return undefined;
  const cassette = parse(readFileSync(path, "utf8")) as Cassette;
  assertCompatible(cassette);
  return cassette;
}

export function saveCassette(path: string, cassette: Cassette): void {
  cassette.meta.updatedAt = new Date().toISOString();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringify(cassette, { lineWidth: 120 }), "utf8");
}

export function loadOrCreate(path: string, recorderVersion: string): Cassette {
  return loadCassette(path) ?? emptyCassette(recorderVersion);
}
