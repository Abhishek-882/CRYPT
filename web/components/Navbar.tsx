"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ShieldCheck, User, LogOut, Terminal, History, Home, Lock, Sparkles, Activity, Bot, Zap } from "lucide-react";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ email: string; role: string; username: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAuth = async () => {
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.isLoggedIn && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuth();
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      setUser(null);
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      } else {
        router.push("/login");
      }
    } catch {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      } else {
        router.push("/login");
      }
    }
  };

  const navLinks: { href: string; label: string; icon: any; adminOnly?: boolean }[] = [
    { href: "/", label: "Intro", icon: Home },
    { href: "/convergence", label: "Convergence", icon: Activity },
    { href: "/divergence", label: "Divergence", icon: Zap },
    { href: "/bot", label: "Fleet Bots", icon: Bot },
    { href: "/history", label: "History", icon: History },
    { href: "/profile", label: "Profile", icon: User },
  ];

  const visibleNavLinks = navLinks.filter((link) => !link.adminOnly || user?.role === "admin");

  return (
    <>
      <nav className="w-full bg-[#09090b]/90 backdrop-blur-xl border-b border-border/80 sticky top-0 z-50 font-mono shadow-md">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
          {/* Brand / Logo */}
          <Link href="/" className="flex items-center space-x-2.5 group active:scale-95 transition-transform">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-accent-amber font-black text-xs group-hover:border-amber-400 group-hover:bg-amber-500/20 transition-all shadow-sm shadow-amber-500/10">
              Δ
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-black tracking-wider text-zinc-100 uppercase group-hover:text-accent-amber transition-colors flex items-center space-x-1">
                <span>SAFECOINER</span>
                <span className="text-zinc-500 font-normal">{"// QUANT"}</span>
              </span>
              <span className="text-[9px] text-zinc-500 font-normal">
                Delta-Neutral Arbitrage
              </span>
            </div>
          </Link>

          {/* Center Nav Links with Aceternity / Magic UI pill transitions */}
          <div className="hidden sm:flex items-center space-x-1.5 p-1 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
            {visibleNavLinks.map((link) => {
              const Icon = link.icon;
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
                    isActive
                      ? "bg-zinc-800 text-accent-amber border border-zinc-700 shadow-sm shadow-amber-500/5 ring-1 ring-amber-500/20"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/80"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? "text-accent-amber animate-pulse" : "text-zinc-500"}`} />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>

          {/* User Status */}
          <div className="flex items-center space-x-2 text-xs">
            {loading ? (
              <div className="w-16 h-7 bg-zinc-900 animate-pulse rounded-lg" />
            ) : user ? (
              <div className="flex items-center space-x-2">
                <Link
                  href="/profile"
                  className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-surface-card hover:bg-zinc-800 border border-border text-[11px] text-zinc-300 transition-colors"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-emerald animate-pulse" />
                  <span className="max-w-[120px] truncate">{user.username || user.email}</span>
                  {user.role === "admin" && (
                    <span className="text-[9px] px-1 rounded bg-amber-500/20 text-accent-amber border border-amber-500/40 font-bold">
                      ADMIN
                    </span>
                  )}
                </Link>
                <button
                  onClick={handleLogout}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-border text-xs transition-colors active:scale-95 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  title="Logout"
                  aria-label="Logout of session"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                aria-label="Sign in to platform"
                className="px-3 py-1.5 rounded-lg bg-accent-amber hover:bg-amber-400 text-zinc-950 font-bold text-xs flex items-center space-x-1.5 transition-colors shadow-sm active:scale-95 min-h-[36px]"
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Login</span>
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile Bottom Dock Navigation (WCAG 44px Touch Targets) */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#09090b]/95 backdrop-blur-xl border-t border-border/80 px-2 py-1 flex items-center justify-around font-mono shadow-2xl">
        {visibleNavLinks.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-label={`Navigate to ${link.label}`}
              className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-lg text-[10px] min-h-[44px] min-w-[48px] transition-all active:scale-95 ${
                isActive
                  ? "text-accent-amber font-bold"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Icon className={`w-4 h-4 mb-0.5 ${isActive ? "text-accent-amber animate-pulse" : "text-zinc-500"}`} aria-hidden="true" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
