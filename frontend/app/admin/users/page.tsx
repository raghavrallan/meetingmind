"use client";

import { useState, useEffect, useCallback } from "react";
import { DataTable } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, Search, MoreHorizontal, AlertTriangle, Ban } from "lucide-react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface User {
  id: string;
  name: string;
  email: string;
  auth_provider: string;
  credit_balance: number;
  is_admin: boolean;
  is_active: boolean;
  status: string;
  suspended_reason?: string;
  created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [suspendModal, setSuspendModal] = useState<{ open: boolean; userId: string; userName: string }>({ open: false, userId: "", userName: "" });
  const [suspendReason, setSuspendReason] = useState("");
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; userId: string; userName: string }>({ open: false, userId: "", userName: "" });
  const [actionLoading, setActionLoading] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        per_page: "20",
      });
      if (search) params.set("search", search);
      const res = await fetch(
        `${API_BASE}/api/v1/admin/users?${params}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
        setTotal(data.total ?? 0);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = statusFilter === "all"
    ? users
    : users.filter((u) => u.status === statusFilter);

  async function handleAction(userId: string, action: string, body?: object) {
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/users/${userId}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }
      );
      if (res.ok) await fetchUsers();
    } catch {
      // silently fail
    }
  }

  const columns = [
    {
      key: "name",
      label: "Name",
      render: (u: User) => (
        <Link
          href={`/admin/users/${u.id}`}
          className="font-medium text-primary hover:underline"
        >
          {u.name}
        </Link>
      ),
    },
    { key: "email", label: "Email" },
    {
      key: "auth_provider",
      label: "Provider",
      render: (u: User) => (
        <Badge variant="secondary">{u.auth_provider}</Badge>
      ),
    },
    {
      key: "credit_balance",
      label: "Credits",
      render: (u: User) => u.credit_balance?.toLocaleString() ?? "0",
    },
    {
      key: "is_admin",
      label: "Admin",
      render: (u: User) =>
        u.is_admin ? <Badge>Admin</Badge> : <span className="text-muted-foreground">—</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (u: User) => {
        const variant =
          u.status === "active"
            ? "default"
            : u.status === "deleted"
              ? "destructive"
              : "secondary";
        const className =
          u.status === "active"
            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
            : u.status === "suspended"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
              : undefined;
        return (
          <Badge variant={variant} className={className}>
            {u.status === "active"
              ? "Active"
              : u.status === "suspended"
                ? "Suspended"
                : u.status === "deleted"
                  ? "Deleted"
                  : u.status}
          </Badge>
        );
      },
    },
    {
      key: "created_at",
      label: "Joined",
      render: (u: User) => new Date(u.created_at).toLocaleDateString(),
    },
    {
      key: "actions",
      label: "Actions",
      render: (u: User) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/admin/users/${u.id}`}>View Details</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {!u.is_admin ? (
              <DropdownMenuItem onClick={() => handleAction(u.id, "make-admin")}>
                Make Admin
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => handleAction(u.id, "remove-admin")}>
                Remove Admin
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {u.status === "active" && (
              <DropdownMenuItem
                onClick={() => {
                  setSuspendReason("");
                  setSuspendModal({ open: true, userId: u.id, userName: u.name });
                }}
              >
                <Ban className="mr-2 h-4 w-4" />
                Suspend User
              </DropdownMenuItem>
            )}
            {u.status === "suspended" && (
              <DropdownMenuItem onClick={() => handleAction(u.id, "reactivate")}>
                Reactivate User
              </DropdownMenuItem>
            )}
            {(u.status === "active" || u.status === "suspended") && (
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteModal({ open: true, userId: u.id, userName: u.name })}
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                Delete User
              </DropdownMenuItem>
            )}
            {u.status === "deleted" && (
              <DropdownMenuItem onClick={() => handleAction(u.id, "restore")}>
                Restore User
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Users</h1>

      <div className="flex flex-wrap gap-2">
        {(["all", "active", "suspended", "deleted"] as const).map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
          >
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="pl-9"
        />
      </div>

      <DataTable
        columns={columns}
        data={filteredUsers}
        total={total}
        page={page}
        perPage={20}
        onPageChange={setPage}
        isLoading={loading}
      />

      {/* Suspend User Modal */}
      <Dialog open={suspendModal.open} onOpenChange={(open) => setSuspendModal((prev) => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-amber-500" />
              Suspend User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Suspending <span className="font-medium text-foreground">{suspendModal.userName}</span> will prevent them from logging in. You can reactivate them at any time.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason for suspension</label>
              <Input
                placeholder="e.g. Violation of terms, Suspicious activity..."
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSuspendModal({ open: false, userId: "", userName: "" })}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!suspendReason.trim() || actionLoading}
              onClick={async () => {
                setActionLoading(true);
                await handleAction(suspendModal.userId, "suspend", { reason: suspendReason.trim() });
                setSuspendModal({ open: false, userId: "", userName: "" });
                setSuspendReason("");
                setActionLoading(false);
              }}
            >
              {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
              Suspend User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Modal */}
      <Dialog open={deleteModal.open} onOpenChange={(open) => setDeleteModal((prev) => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <span className="font-medium text-foreground">{deleteModal.userName}</span>?
            </p>
            <p className="text-sm text-muted-foreground">
              This is a soft delete -- the user's data (meetings, billing, transcripts) will be preserved. They will not be able to log in. You can restore them later.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteModal({ open: false, userId: "", userName: "" })}
              disabled={actionLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={actionLoading}
              onClick={async () => {
                setActionLoading(true);
                await handleAction(deleteModal.userId, "delete");
                setDeleteModal({ open: false, userId: "", userName: "" });
                setActionLoading(false);
              }}
            >
              {actionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
