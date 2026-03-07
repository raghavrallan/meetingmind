"use client";

import { useState, useEffect } from "react";
import { DataTable } from "@/components/admin/data-table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
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
  created_at: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
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
    }
    load();
  }, [page, search]);

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
      key: "is_active",
      label: "Status",
      render: (u: User) => (
        <Badge variant={u.is_active ? "default" : "destructive"}>
          {u.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "created_at",
      label: "Joined",
      render: (u: User) => new Date(u.created_at).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Users</h1>

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
        data={users}
        total={total}
        page={page}
        perPage={20}
        onPageChange={setPage}
        isLoading={loading}
      />
    </div>
  );
}
