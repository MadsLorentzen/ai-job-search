"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/resume", label: "Resume" },
  { href: "/jobs", label: "Jobs" },
  { href: "/applications", label: "Applications" },
  { href: "/settings", label: "Settings" },
];

const PUBLIC_PATHS = ["/login", "/signup"];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  if (PUBLIC_PATHS.includes(pathname)) return null;

  const logout = async () => {
    await api.logout();
    router.replace("/login");
  };

  return (
    <nav className="border-b border-black/10 dark:border-white/15">
      <div className="mx-auto max-w-5xl flex items-center gap-1 px-4">
        <div className="flex flex-1 gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? "border-foreground text-foreground"
                    : "border-transparent text-foreground/60 hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
        <button
          onClick={logout}
          className="px-3 py-1.5 text-xs text-foreground/60 hover:text-foreground"
        >
          Log out
        </button>
      </div>
    </nav>
  );
}
