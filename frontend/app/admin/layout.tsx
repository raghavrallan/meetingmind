"use client";

import { useState } from "react";
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
  Eye,
  Shield,
  Loader2,
  LogOut,
  Menu,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const navItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/keys", label: "API Keys", icon: Key },
  { href: "/admin/usage", label: "Usage", icon: BarChart3 },
  { href: "/admin/meetings", label: "Meetings", icon: Mic },
  { href: "/admin/credits", label: "Credits", icon: Coins },
];

function AdminNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/admin" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
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
  );
}

function SidebarFooter({ logout }: { logout: () => void }) {
  return (
    <div className="border-t border-[hsl(var(--border))] px-3 py-4 space-y-2">
      <button
        onClick={() => {
          document.cookie = "admin_viewing_as_user=true;path=/;max-age=86400;samesite=lax";
          window.location.href = "/";
        }}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Eye className="h-4 w-4" />
        View as User
      </button>
      <button
        onClick={() => logout()}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/10"
      >
        <LogOut className="h-4 w-4" />
        Log out
      </button>
    </div>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user?.is_admin) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 p-4">
        <Shield className="h-12 w-12 text-destructive" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground text-center max-w-sm">
          You do not have permission to access the admin panel.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              document.cookie = "admin_viewing_as_user=true;path=/;max-age=86400;samesite=lax";
              window.location.href = "/";
            }}
            className="text-sm text-primary underline hover:text-primary/80"
          >
            Go to Dashboard
          </button>
          <button
            onClick={() => logout()}
            className="text-sm text-destructive underline hover:text-destructive/80"
          >
            Log out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 z-30 h-full w-64 flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="flex items-center gap-2 border-b border-[hsl(var(--border))] px-6 py-4">
          <Shield className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">Admin</span>
        </div>
        <AdminNav pathname={pathname} />
        <SidebarFooter logout={logout} />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b border-[hsl(var(--border))] px-6 py-4">
            <SheetTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Admin
            </SheetTitle>
          </SheetHeader>
          <AdminNav pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          <SidebarFooter logout={logout} />
        </SheetContent>
      </Sheet>

      <div className="flex flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-[hsl(var(--border))] bg-background/95 px-4 lg:px-6 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <Badge>Admin</Badge>
            <span className="text-sm text-muted-foreground hidden sm:inline">
              Admin Dashboard
            </span>
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-muted-foreground truncate">{user.name}</span>
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              {user.email}
            </span>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
