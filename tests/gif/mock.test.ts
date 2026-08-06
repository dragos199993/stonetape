// Act 1 of the GIF: the buggy agent, tested with a hand-written mock. Green.
import { describe, expect, it } from "vitest";
import { handWrittenMock, weatherAgent } from "./agent.js";

describe.skipIf(!process.env.GIF)("weather agent (hand-written mock)", () => {
  it("answers the weather question", async () => {
    const answer = await weatherAgent(handWrittenMock, { buggy: true });
    expect(answer).toBeTruthy(); // ✓ ship it! (the bug is invisible)
  });
});
