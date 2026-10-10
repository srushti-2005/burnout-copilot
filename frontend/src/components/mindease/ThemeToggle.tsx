import { useTheme } from "@/lib/useTheme";

/** Visible "Light [switch] Dark" control. Dark is the default. Styles live in styles.css. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <span className={`me-theme ${className}`.trim()}>
      <span data-active={!isDark} aria-hidden="true">
        Light
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        aria-label="Dark mode"
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        className="me-toggle"
        onClick={toggle}
      >
        <span className="me-toggle__thumb" aria-hidden="true" />
        <svg className="me-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <svg className="me-moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>
      <span data-active={isDark} aria-hidden="true">
        Dark
      </span>
    </span>
  );
}

export default ThemeToggle;