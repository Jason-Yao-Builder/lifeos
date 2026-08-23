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

export function SettingsIcon({ className = "" }: CoachIconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={`settings-icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5" />
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}
