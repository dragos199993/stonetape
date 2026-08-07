/**
 * Terminal styling, stonetape-brand edition. Zero dependencies.
 *
 * The palette mirrors the visual identity: REC red for recording moments,
 * dim for tape metadata, green for additions, yellow for drift. Colors are
 * disabled when not writing to a TTY, when NO_COLOR is set (https://no-color.org),
 * or when TERM=dumb, so piped output and CI logs stay clean.
 */

function colorsEnabled(stream: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === "dumb") return false;
  return stream.isTTY === true;
}

function make(stream: NodeJS.WriteStream) {
  const on = colorsEnabled(stream);
  const wrap = (open: string, close: string) => (s: string) =>
    on ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    red: wrap("31", "39"),
    green: wrap("32", "39"),
    yellow: wrap("33", "39"),
    dim: wrap("2", "22"),
    bold: wrap("1", "22"),
  };
}

/** Styles for stdout (CLI output). */
export const out = make(process.stdout);

/** Styles for stderr (in-test notices like the REC summary). */
export const err = make(process.stderr);

/** The REC dot, red when possible. */
export const recDot = (s: ReturnType<typeof make>) => s.red("\u25cf");
