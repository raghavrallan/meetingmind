"use client";

import { useAuth } from "@/lib/hooks/use-auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Key,
  BarChart3,
  Mic,
  Coins,
  ArrowLeft,
  Shield,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const navItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/keys", label: "API Keys", icon: Key },
  { href: "/admin/usage", label: "Usage", icon: BarChart3 },
  { href: "/admin/meetings", label: "Meetings", icon: Mic },
  { href: "/admin/credits", label: "Credits", icon: Coins },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const pathname = usePathname();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user?.is_admin) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <Shield className="h-12 w-12 text-destructive" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">
          You do not have permission to access the admin panel.
        </p>
        <Link href="/" className="text-primary underline hover:text-primary/80">
          Back to App
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <aside className="fixed left-0 top-0 z-30 flex h-full w-64 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-6 py-4">
          <Shield className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">Admin</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[hsl(var(--border))] px-3 py-4">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to App
          </Link>
        </div>
      </aside>

      <div className="flex flex-1 flex-col pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[hsl(var(--border))] bg-background/95 px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <Badge>Admin</Badge>
            <span className="text-sm text-muted-foreground">
              Admin Dashboard
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user.name}</span>
            <span className="text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
