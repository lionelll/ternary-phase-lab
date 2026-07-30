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
