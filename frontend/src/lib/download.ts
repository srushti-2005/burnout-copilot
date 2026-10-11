// src/lib/download.ts
/**
 * Programmatically triggers the download of MindEaseAgent.exe
 */
export function triggerAgentDownload(): void {
  try {
    const link = document.createElement("a");
    link.href = "/downloads/MindEaseAgent.exe";
    link.download = "MindEaseAgent.exe";
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
    window.open("/downloads/MindEaseAgent.exe", "_blank");
  }
}
