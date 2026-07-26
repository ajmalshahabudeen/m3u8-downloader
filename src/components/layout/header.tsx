"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HiOutlineDownload,
  HiOutlineViewGridAdd,
  HiOutlineSearchCircle,
} from "react-icons/hi";
import { AnimatedThemeToggler } from "@/components/magic-ui/animated-theme-toggler";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Single Download", icon: HiOutlineDownload },
  { href: "/batch", label: "Batch Downloads", icon: HiOutlineViewGridAdd },
  { href: "/extract", label: "From URL", icon: HiOutlineSearchCircle },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-900 border border-indigo-500/40 shadow-sm">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="shrink-0"
              >
                <path
                  d="M3 5.5C3 4.6 4 4.1 4.8 4.6L11.2 9.1C11.9 9.6 11.9 10.7 11.2 11.1L4.8 15.6C4 16.1 3 15.6 3 14.7V5.5Z"
                  fill="url(#hdr-gradient-play)"
                />
                <path
                  d="M17 4V13M17 13L13.5 9.5M17 13L20.5 9.5"
                  stroke="url(#hdr-gradient-arrow)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M13.5 17H20.5"
                  stroke="url(#hdr-gradient-arrow)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient
                    id="hdr-gradient-play"
                    x1="3"
                    y1="4.6"
                    x2="11.2"
                    y2="15.6"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#6366F1" />
                    <stop offset="1" stopColor="#A855F7" />
                  </linearGradient>
                  <linearGradient
                    id="hdr-gradient-arrow"
                    x1="17"
                    y1="4"
                    x2="17"
                    y2="17"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop stopColor="#38BDF8" />
                    <stop offset="1" stopColor="#6366F1" />
                  </linearGradient>
                </defs>
              </svg>
            </span>
            <span className="hidden font-heading sm:inline">m3u8 Downloader</span>
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {links.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/" ? pathname === "/" : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-sm whitespace-nowrap transition-colors sm:px-3",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="hidden lg:inline">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <AnimatedThemeToggler />
      </div>
    </header>
  );
}
