// Act 2 of the GIF: the SAME buggy agent, tested against a cassette recorded
// from the real API. This test FAILS — on purpose, on camera.
import { describe, expect, it } from "vitest";
import { openCassette } from "../../src/index.js";
import { CASSETTE, weatherAgent } from "./agent.js";

describe.skipIf(!process.env.GIF)("weather agent (real recorded cassette)", () => {
  it("answers the weather question", async () => {
    const tape = openCassette(CASSETTE, { mode: "replay" });
    try {
      const answer = await weatherAgent(tape.fetch, { buggy: true });
      expect(answer).toBeTruthy();
    } finally {
      tape.close();
    }
  });
});
