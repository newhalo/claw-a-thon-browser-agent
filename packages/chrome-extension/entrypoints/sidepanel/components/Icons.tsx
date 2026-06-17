import React from 'react';

/** Circular arc logo — 3 arc segments + center dot, matches extension icon and website header */
export function AgentLogo({ size = 22 }: { size?: number }) {
  // 24×24 viewBox: center (12,12), radius 8.25, dot r=1.875
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* top → right */}
      <path d="M 12 3.75 A 8.25 8.25 0 0 1 20.25 12" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"/>
      {/* right → bottom */}
      <path d="M 20.25 12 A 8.25 8.25 0 0 1 12 20.25" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
      {/* bottom → left */}
      <path d="M 12 20.25 A 8.25 8.25 0 0 1 3.75 12" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" opacity="0.4"/>
      {/* center dot */}
      <circle cx="12" cy="12" r="1.875" fill="var(--success)"/>
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
