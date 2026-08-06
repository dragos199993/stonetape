// Act 3 of the GIF: the fix (JSON.parse the tool arguments) + the cassette. Green, offline, fast.
import { describe, expect, it } from "vitest";
import { openCassette } from "../../src/index.js";
import { CASSETTE, weatherAgent } from "./agent.js";

describe.skipIf(!process.env.GIF)("weather agent, fixed (real recorded cassette)", () => {
  it("answers the weather question — offline, no API key", async () => {
    const tape = openCassette(CASSETTE, { mode: "replay" });
    try {
      const answer = await weatherAgent(tape.fetch);
      expect(answer).toBeTruthy();
    } finally {
      tape.close();
    }
  });
});
