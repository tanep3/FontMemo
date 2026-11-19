// Save / share (design §2). The PNG blob is generated at preview time, so
// the share button can call navigator.share inside the user-gesture window.

export function savePng(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function canSharePng(filename: string): boolean {
  if (typeof navigator === "undefined" || !("canShare" in navigator)) return false;
  try {
    const probe = new File([new Blob(["x"], { type: "image/png" })], filename, {
      type: "image/png",
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function sharePng(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: "image/png" });
  await navigator.share({ files: [file] });
}
