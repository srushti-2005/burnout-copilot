// src/lib/download.ts
/**
 * Downloads the MindEase PC Agent.
 * Defaults to .zip format to prevent Chrome / Edge "Unverified download blocked" errors.
 */
export function triggerAgentDownload(format: "zip" | "exe" = "zip"): void {
  const filename = format === "zip" ? "MindEaseAgent.zip" : "MindEaseAgent.exe";
  const url = `/downloads/${filename}`;
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      try {
        document.body.removeChild(link);
      } catch {
        /* already removed */
      }
    }, 500);
  } catch (err) {
    console.error("Failed to trigger agent download:", err);
    window.open(url, "_blank");
  }
}
