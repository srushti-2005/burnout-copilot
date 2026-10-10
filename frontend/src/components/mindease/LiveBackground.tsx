import { StarField } from "./StarField";

/**
 * Live moving background: drifting green / red / violet glows, a slow aurora ribbon and
 * twinkling stars. Kept deliberately light so the glass cards on top stay readable.
 * Mounted once in __root.tsx so it sits behind every page (including login).
 */
export function LiveBackground() {
  return (
    <div className="me-live" aria-hidden="true">
      <div className="me-live__blob me-live__blob--green" />
      <div className="me-live__blob me-live__blob--red" />
      <div className="me-live__blob me-live__blob--violet" />
      <div className="me-live__aurora" />
      <StarField className="me-live__stars" />
    </div>
  );
}