import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function SidebarIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M9 4.5v15" />
    </IconBase>
  );
}

export function FolderPlusIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l1.5 2H18a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6A2.5 2.5 0 0 1 3.5 16.5z" />
      <path d="M15.5 11.5v4" />
      <path d="M13.5 13.5h4" />
    </IconBase>
  );
}

export function ComposeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 20h8" />
      <path d="M16.5 4.5a2.1 2.1 0 1 1 3 3L8.5 18.5 4 20l1.5-4.5z" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="5.5" />
      <path d="M18 18l2.5 2.5" />
    </IconBase>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 8A2.5 2.5 0 0 1 6 5.5h4l1.6 1.8H18A2.5 2.5 0 0 1 20.5 9.8v6.7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" />
    </IconBase>
  );
}

export function NoteIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="5" y="4.5" width="14" height="15" rx="2.5" />
      <path d="M8.5 9h7" />
      <path d="M8.5 12.5h7" />
      <path d="M8.5 16h4.5" />
    </IconBase>
  );
}

export function MarkdownIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 7.5v9l3.5-4 3.5 4v-9" />
      <path d="M14 16.5h5" />
      <path d="M15 13.5h4" />
      <path d="M16 10.5h3" />
    </IconBase>
  );
}
