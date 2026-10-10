/** Round gradient badge holding the MindEase star. Used in the sidebar and on the login screen. */
export function MindEaseMark({ className = "size-10" }: { className?: string }) {
  return (
    <span className={`me-mark grid shrink-0 place-items-center rounded-full ${className}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" className="size-[55%]" fill="#fff">
        <path d="M24 4 C25.6 17 31 22.4 44 24 C31 25.6 25.6 31 24 44 C22.4 31 17 25.6 4 24 C17 22.4 22.4 17 24 4Z" />
      </svg>
    </span>
  );
}