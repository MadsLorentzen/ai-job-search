"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, setUnauthorizedHandler } from "@/lib/api";

const PUBLIC_PATHS = ["/login", "/signup"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const [checked, setChecked] = useState(isPublic);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!PUBLIC_PATHS.includes(window.location.pathname)) {
        router.replace("/login");
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  useEffect(() => {
    if (isPublic) {
      setChecked(true);
      return;
    }
    setChecked(false);
    api
      .me()
      .then(() => setChecked(true))
      .catch(() => router.replace("/login"));
  }, [pathname, isPublic, router]);

  if (!checked) return null;
  return <>{children}</>;
}
