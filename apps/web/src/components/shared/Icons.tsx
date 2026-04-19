type IconProps = { size?: number; color?: string };

export function FolderIcon({ size = 20, color = "#007AFF" }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path
        d="M2 5.5A1.5 1.5 0 013.5 4h4.086a1.5 1.5 0 011.06.44l.915.914A1.5 1.5 0 0010.621 6H16.5A1.5 1.5 0 0118 7.5v8A1.5 1.5 0 0116.5 17h-13A1.5 1.5 0 012 15.5v-10z"
        fill={color}
        fillOpacity="0.2"
        stroke={color}
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function AllNotesIcon({
  size = 20,
  color = "#007AFF",
  active = false,
}: IconProps & { active?: boolean }) {
  const c = active ? "white" : color;
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path
        d="M3 4h14v13H3z"
        fill={c}
        fillOpacity={active ? 0.2 : 0.15}
        stroke={c}
        strokeWidth="1.2"
        rx="2"
      />
      <path
        d="M6 8h8M6 11h5"
        stroke={c}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TrashIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <path
        d="M7 4h6M5 4h10v12a1 1 0 01-1 1H6a1 1 0 01-1-1V4z"
        stroke="#FF3B30"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M8 8v5M12 8v5"
        stroke="#FF3B30"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SearchIcon({ size = 13 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
      <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M9 9l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ComposeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <path
        d="M3 14l1.5-4.5L12 2l2.5 2.5-7.5 7.5L3 14z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M11 3.5l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoreIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <circle cx="5" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15" cy="10" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function BackIcon({ size = 10 }: IconProps) {
  return (
    <svg
      width={size}
      height={Math.round(size * 1.7)}
      viewBox="0 0 10 17"
      fill="none"
    >
      <path
        d="M9 1L1 8.5L9 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronIcon({ size = 7 }: IconProps) {
  return (
    <svg
      width={size}
      height={Math.round(size * 1.7)}
      viewBox="0 0 7 12"
      fill="none"
    >
      <path
        d="M1 1l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M8 1v14M1 8h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SyncIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path
        d="M1 6a5 5 0 109.9-1M11 2v3H8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function EmptyNoteIcon({ size = 56 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none">
      <rect
        x="8"
        y="4"
        width="40"
        height="48"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M16 18h24M16 26h24M16 34h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
