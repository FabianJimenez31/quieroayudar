type IconName =
  | "alert"
  | "arrow-left"
  | "arrow-right"
  | "building"
  | "check"
  | "close"
  | "download"
  | "external"
  | "flame"
  | "home"
  | "location"
  | "minus"
  | "package"
  | "plus"
  | "refresh"
  | "reports"
  | "share"
  | "users";

const paths: Record<IconName, React.ReactNode> = {
  alert: <><path d="M12 3 2.7 20h18.6L12 3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  "arrow-left": <><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></>,
  "arrow-right": <><path d="M5 12h14" /><path d="m15 6 6 6-6 6" /></>,
  building: <><path d="M4 21V7l8-4 8 4v14" /><path d="M2 21h20" /><path d="M8 9h2M14 9h2M8 13h2M14 13h2M10 21v-4h4v4" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  external: <><path d="M14 5h5v5" /><path d="m19 5-9 9" /><path d="M19 14v5H5V5h5" /></>,
  flame: <path d="M12 2c1 3-3 4-3 8a3 3 0 0 0 6 0c1 0 2 1 2 3a5 5 0 0 1-10 0c0-5 3-6 3-9 0-1 1-2 2-2Z" />,
  home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M9 20v-6h6v6" /></>,
  location: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  minus: <path d="M5 12h14" />,
  package: <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M4 7v10l8 4 8-4V7" /><path d="M12 11v10" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8a7 7 0 0 1 11.6-2.2L20 8M4 16l2.3 2.2A7 7 0 0 0 18 16" /></>,
  reports: <><path d="M5 21V4" /><path d="M5 5h11l-2 4 2 4H5" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4" /><path d="m15.4 6.5-6.8 4" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
};

export default function UiIcon({ name, size = 20, label, className = "" }: { name: IconName; size?: number; label?: string; className?: string }) {
  return <svg className={`ui-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined}>{paths[name]}</svg>;
}

export type { IconName };
