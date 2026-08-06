# stonetape demo GIF — record with: vhs assets/demo.tape
Output assets/demo.gif

Set FontSize 16
Set Width 1200
Set Height 800
Set Theme "Catppuccin Mocha"
Set TypingSpeed 25ms

Hide
Type "export GIF=1" Enter
Type "clear" Enter
Show

Type "# agent bug: tool args treated as an object (the real API sends a JSON string)"
Enter
Sleep 800ms

Type "# 1) tested with a hand-written mock:"
Enter
Type "npx vitest run gif/mock"
Enter
Wait+Screen /1 passed/
Sleep 1.5s
Type "# green — ship it 🚢"
Enter
Sleep 1s

Hide
Type "clear" Enter
Show
Type "# 2) same code vs a cassette recorded from the REAL API:"
Enter
Type "npx vitest run gif/cassette"
Enter
Wait+Screen /Expected call/
Sleep 3s

Hide
Type "clear" Enter
Show
Type "# 3) fix the bug, replay the cassette:"
Enter
Type "npx vitest run gif/fixed"
Enter
Wait+Screen /1 passed/
Sleep 1s
Type "# offline · no API keys · deterministic — stonetape.dev"
Enter
Sleep 2.5s
