"use client";

import { useState, useEffect } from "react";
import { DataTable } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface Meeting {
  id: string;
  title: string;
  status: string;
  duration: number;
  language: string;
  user_id: string;
  user_name?: string;
  created_at: string;
}

const statusOptions = ["all", "active", "completed", "failed"] as const;

function statusBadgeVariant(status: string) {
  switch (status) {
    case "completed":
      return "default" as const;
    case "active":
      return "secondary" as const;
    case "failed":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

export default function AdminMeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          per_page: "20",
        });
        if (statusFilter !== "all") params.set("status", statusFilter);
        const res = await fetch(
          `${API_BASE}/api/v1/admin/meetings?${params}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data = await res.json();
          setMeetings(data.meetings ?? []);
          setTotal(data.total ?? 0);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [page, statusFilter]);

  function formatDuration(seconds: number) {
    if (!seconds) return "—";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  const columns = [
    { key: "title", label: "Title" },
    {
      key: "status",
      label: "Status",
      render: (m: Meeting) => (
        <Badge variant={statusBadgeVariant(m.status)}>{m.status}</Badge>
      ),
    },
    {
      key: "duration",
      label: "Duration",
      render: (m: Meeting) => formatDuration(m.duration),
    },
    {
      key: "language",
      label: "Language",
      render: (m: Meeting) => m.language ?? "—",
    },
    {
      key: "user_name",
      label: "User",
      render: (m: Meeting) => m.user_name ?? m.user_id?.slice(0, 8) + "...",
    },
    {
      key: "created_at",
      label: "Date",
      render: (m: Meeting) => new Date(m.created_at).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Meetings</h1>

      <div className="flex items-center gap-2">
        {statusOptions.map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatusFilter(s);
              setPage(1);
            }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={meetings}
        total={total}
        page={page}
        perPage={20}
        onPageChange={setPage}
        isLoading={loading}
      />
    </div>
  );
}
