"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleDollarSign, FileCheck2, LayoutDashboard, Menu, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { useState } from "react";
import { WalletButton } from "./WalletButton";
import { useAuth } from "./AuthProvider";

const clientLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Contracts", icon: FileCheck2 },
  { href: "/projects/new", label: "New", icon: CircleDollarSign },
  { href: "/dashboard#applications", label: "Applications", icon: Users },
  { href: "/agent-payments", label: "Agent", icon: SlidersHorizontal },
];
const freelancerLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/marketplace", label: "Marketplace", icon: Search },
  { href: "/dashboard#applications", label: "Applications", icon: Users },
  { href: "/projects", label: "Contracts", icon: FileCheck2 },
  { href: "/agent-payments", label: "Agent", icon: SlidersHorizontal },
];

/** A link is active on its own page; "Contracts" also stays active inside a project but not on "New". */
function isActive(pathname: string, href: string): boolean {
  if (href === "/projects") return pathname === "/projects" || (pathname.startsWith("/projects/") && pathname !== "/projects/new");
  // A hash link points at a section, not a page, so it must never claim the active state;
  // otherwise /dashboard and /dashboard#applications both highlight at once.
  if (href.includes("#")) return false;
  return pathname === href;
}

/** The TRUSTORA mark: a sealed aperture, drawn rather than imported, so it scales cleanly. */
function Mark() {
  return (
    <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-ink">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M12 3.2 19 6.4v5.3c0 4.2-2.8 7.6-7 9.1-4.2-1.5-7-4.9-7-9.1V6.4Z" fill="none" stroke="#f5f5f0" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M9 12.2l2.2 2.2L15.2 10" fill="none" stroke="#a8b9aa" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const auth = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const links = auth.accountRole === "FREELANCER" ? freelancerLinks : clientLinks;

  const nav = (mobile: boolean) =>
    links.map((l) => {
      const active = isActive(pathname, l.href);
      return (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active ? "page" : undefined}
          onClick={() => setMobileOpen(false)}
          className={`group relative flex items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors duration-150 ${
            mobile ? "w-full" : ""
          } ${active ? "text-ink" : "text-ink-3 hover:text-ink"}`}
        >
          <l.icon className={`h-4 w-4 shrink-0 transition-colors ${active ? "text-royal" : "text-ink-3 group-hover:text-ink-2"}`} />
          <span className={active ? "font-medium" : ""}>{l.label}</span>
          {/* The active indicator is a short underscore, not a filled pill. */}
          {active && !mobile && <span aria-hidden className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-royal" />}
        </Link>
      );
    });

  return (
    <div className="sticky top-0 z-40 px-5 pt-4 sm:px-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-8 focus:top-2 focus:z-50 focus:rounded-sm focus:bg-ink focus:px-3 focus:py-2 focus:text-xs focus:text-ink-inverse">
        Skip to content
      </a>
      <header className="glass glass-sheen mx-auto w-full max-w-content rounded-md">
        <div className="flex items-center gap-4 px-4 py-2.5 sm:px-5">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            <Mark />
            <span className="display text-[1.0625rem] font-extrabold tracking-[-0.04em] text-ink">TRUSTORA</span>
          </Link>

          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {nav(false)}
          </nav>

          <div className="ml-auto flex items-center gap-2.5">
            <span className="hidden items-center gap-2 rounded-full border border-rule bg-surface/70 px-2.5 py-1.5 text-[0.6875rem] font-medium text-ink-2 md:inline-flex">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inset-0 rounded-full bg-ok" />
              </span>
              Arc Testnet
            </span>
            {auth.accountRole && (
              <span className="hidden rounded-full bg-royal-wash px-2.5 py-1.5 text-[0.6875rem] font-semibold text-royal-deep xl:inline-flex">
                {auth.accountRole === "CLIENT" ? "Client" : "Freelancer"}
              </span>
            )}
            <WalletButton />
            <button
              type="button"
              aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(!mobileOpen)}
              className="neu neu-press inline-flex h-9 w-9 items-center justify-center rounded-sm text-ink-2 lg:hidden"
            >
              {mobileOpen ? <X className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <nav className="anim-fade rule-t grid gap-0.5 px-3 py-3 lg:hidden" aria-label="Mobile main">
            {nav(true)}
          </nav>
        )}
      </header>
    </div>
  );
}
