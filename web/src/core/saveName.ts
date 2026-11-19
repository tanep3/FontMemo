// Shared save-name rule (same as the other apps): the app name plus a
// local-time timestamp down to the second; repeats within one session get
// -2, -3, ... There is intentionally no name input UI (design §5.5).

const BASE = "fontmemo";
const handedOut = new Set<string>();

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function nextSaveName(now: Date = new Date()): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  let candidate = `${BASE}-${stamp}.png`;
  for (let n = 2; handedOut.has(candidate); n++) {
    candidate = `${BASE}-${stamp}-${n}.png`;
  }
  handedOut.add(candidate);
  return candidate;
}
