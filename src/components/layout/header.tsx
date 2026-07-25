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
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-heading text-sm text-primary-foreground">
              M8
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
