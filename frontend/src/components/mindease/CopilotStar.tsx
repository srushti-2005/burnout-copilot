import { X } from "lucide-react";

import { RobotAvatar } from "./RobotAvatar";

interface Props {
  open: boolean;
  /** Show the small coral "needs attention" dot (same meaning as the old button). */
  attention?: boolean;
  onClick: () => void;
}

/** Co-pilot badge: friendly robot avatar with a soft pulsing aura. */
export function CopilotStar({ open, attention = false, onClick }: Props) {
  return (
    <button
      type="button"
      className="me-star"
      aria-label={open ? "Close co-pilot" : "Open co-pilot"}
      aria-expanded={open}
      onClick={onClick}
    >
      <span className="me-star__aura" aria-hidden="true" />
      {!open && (
        <>
          <span className="me-star__dot" aria-hidden="true" />
          <span className="me-star__dot" aria-hidden="true" />
          <span className="me-star__dot" aria-hidden="true" />
          <span className="me-star__dot" aria-hidden="true" />
        </>
      )}
      {open ? (
        <X className="relative size-6" aria-hidden="true" />
      ) : (
        <RobotAvatar className="me-star__icon" />
      )}
      {!open && attention && <span className="me-star__alert" aria-label="Needs attention" />}
    </button>
  );
}

export default CopilotStar;