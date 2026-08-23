import type { ReactElement } from "react";

interface CoachIconProps {
  className?: string;
}

export function CoachIcon({ className = "" }: CoachIconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={`coach-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="8" cy="7" r="3" />
      <path d="M3.5 19c.35-3.8 1.95-6 4.5-6s4.15 2.2 4.5 6" />
      <path d="M14 4.5h5.5v6H17l-2.5 2v-2H14z" />
      <path d="M16 7.5h1.5" />
    </svg>
  );
}
