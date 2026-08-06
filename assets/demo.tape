# stonetape demo GIF — record with: vhs assets/demo.tape
# (brew install vhs)
Output assets/demo.gif

Set FontSize 16
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Type "# An LLM agent bug: tool arguments treated as an object (the real API sends a JSON string)"
Enter
Sleep 1.5s

Type "# Act 1 — tested with a hand-written mock:"
Enter
Type "GIF=1 npx vitest run tests/gif/1-bug-with-mock.test.ts"
Enter
Sleep 5s
Type "# ✓ green. Ship it! (the bug just went to production)"
Enter
Sleep 2s

Type "clear"
Enter
Type "# Act 2 — SAME code, tested against a cassette recorded from the REAL API:"
Enter
Type "GIF=1 npx vitest run tests/gif/2-bug-with-cassette.test.ts"
Enter
Sleep 7s
Type "# ✗ caught: 'Expected call: 2 of 2' — the diff names the lost \"city\":\"Cluj\""
Enter
Sleep 3s

Type "clear"
Enter
Type "# Act 3 — fix the bug (JSON.parse the arguments), replay the cassette:"
Enter
Type "GIF=1 npx vitest run tests/gif/3-fixed-with-cassette.test.ts"
Enter
Sleep 5s
Type "# ✓ green — offline, no API key, deterministic. stonetape.dev"
Enter
Sleep 3s
