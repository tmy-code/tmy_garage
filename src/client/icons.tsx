/** Line icons drawn the same on every phone, unlike emoji. Decorative: the text next to them carries the meaning. */
const PATHS = {
  car: (
    <>
      <path d="M3 13l2.2-5.2A2 2 0 0 1 7 6.5h10a2 2 0 0 1 1.8 1.3L21 13v4a1 1 0 0 1-1 1h-1M5 18H4a1 1 0 0 1-1-1v-4h18" />
      <circle cx="7.5" cy="17.5" r="2" />
      <circle cx="16.5" cy="17.5" r="2" />
      <path d="M9.5 17.5h5" />
    </>
  ),
  motorcycle: (
    <>
      <circle cx="5" cy="16" r="3" />
      <circle cx="19" cy="16" r="3" />
      <path d="M5 16l4-6h5l5 6M14 10l2-4h3M9 10l-1.5-3H5" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2.4 11h11.1L21 7.5H6.2" />
      <circle cx="9" cy="19.5" r="1.5" />
      <circle cx="17" cy="19.5" r="1.5" />
    </>
  ),
  shield: <path d="M12 3l8 3v6c0 4.8-3.4 8-8 9-4.6-1-8-4.2-8-9V6z" />,
  bell: <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0" />,
  wrench: <path d="M14.7 3.3a5 5 0 0 0-5.3 6.6L3.5 15.8a1.8 1.8 0 0 0 2.6 2.6l5.9-5.9a5 5 0 0 0 6.6-5.3l-3 3-2.8-.6-.6-2.8z" />,
  part: (
    <>
      <path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  document: <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  cloudOff: <path d="M3 3l18 18M8 7.5A5.5 5.5 0 0 1 17.2 10 4 4 0 0 1 20 17.2M17 18H7a4.5 4.5 0 0 1-1.6-8.7" />,
  sync: <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" />,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  chevron: <path d="M9 5l7 7-7 7" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
