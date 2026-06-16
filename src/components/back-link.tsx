import Link from "next/link";

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/80 px-3.5 py-2 text-sm font-medium text-zinc-600 shadow-sm backdrop-blur transition-all hover:border-zinc-300 hover:bg-white hover:text-zinc-900 hover:shadow active:scale-95 [html.capacitor-native_&]:hidden dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="transition-transform duration-200 group-hover:-translate-x-0.5"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      {children}
    </Link>
  );
}
