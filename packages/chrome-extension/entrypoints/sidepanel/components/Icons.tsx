import React from 'react';

/** Claw mark + dot logo — used in the header */
export function AgentLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Three claw marks */}
      <path d="M7 3 C6 5 5.5 7 6.5 9.5" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
      <path d="M9.5 2 C9 4 9 6.5 10.5 9" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12.5 3 C12.5 5 13 7 14.5 9" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
      {/* Bot body */}
      <rect x="5" y="10" width="14" height="9" rx="3" fill="var(--accent)" opacity="0.15" stroke="var(--accent)" strokeWidth="1.5"/>
      {/* Eyes */}
      <circle cx="9.5" cy="15" r="1.5" fill="var(--accent)"/>
      <circle cx="14.5" cy="15" r="1.5" fill="var(--accent)"/>
      {/* Agent dot */}
      <circle cx="19" cy="5" r="3" fill="var(--success)"/>
    </svg>
  );
}

/** Theme icons */
export function SunIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  );
}

export function MoonIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export function SystemThemeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <path d="M8 21h8M12 17v4"/>
    </svg>
  );
}
