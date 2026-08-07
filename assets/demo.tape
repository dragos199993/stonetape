# stonetape demo GIF — record with: vhs assets/demo.tape
Output assets/demo.gif

Set FontSize 16
Set Width 1200
Set Height 800
Set Theme {"name": "stonetape", "background": "#17130e", "foreground": "#e8e2d4", "cursor": "#d43d2a", "selection": "#3a332a", "black": "#211d16", "red": "#d43d2a", "green": "#8aa96b", "yellow": "#d1a34f", "blue": "#9aa4b8", "magenta": "#b98ba5", "cyan": "#8fb3a5", "white": "#e8e2d4", "brightBlack": "#5c5347", "brightRed": "#e05a41", "brightGreen": "#a3c184", "brightYellow": "#e2b968", "brightBlue": "#aeb8cb", "brightMagenta": "#cda3bb", "brightCyan": "#a7c9bc", "brightWhite": "#f4efe3"}
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
Type "# green. ship it 🚢"
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
Type "# offline · no API keys · deterministic · stonetape.dev"
Enter
Sleep 2.5s
