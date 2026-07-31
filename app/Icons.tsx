import type { SVGProps } from "react";

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M3 11 12 3l9 8" />
      <path d="M5.5 10.5V21h13V10.5" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

export function TopViewIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M4 18h16" />
      <path d="m6.5 21-2.5-3 2.5-3" />
      <path d="m17.5 15 2.5 3-2.5 3" />
    </svg>
  );
}
