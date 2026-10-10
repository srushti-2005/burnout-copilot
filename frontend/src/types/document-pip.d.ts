// Ambient types for the Document Picture-in-Picture API (Chrome/Edge 116+).
// Not yet in TypeScript's built-in DOM lib, so declared here as an optional
// property on Window -- code must feature-detect with `"documentPictureInPicture" in window`
// or `!!window.documentPictureInPicture` before using it.
export {};

interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
}

interface DocumentPictureInPicture {
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
  readonly window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}