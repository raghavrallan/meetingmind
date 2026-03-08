"use client";

import { useState, useEffect } from "react";
import { DataTable } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface UsageRecord {
  id: string;
  operation: string;
  provider: string;
  credits_used: number;
  user_id: string;
  created_at: string;
}

const dayOptions = [7, 30, 90] as const;

export default function AdminUsagePage() {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          days: String(days),
          page: String(page),
          per_page: "20",
        });
        const res = await fetch(
          `${API_BASE}/api/v1/admin/usage?${params}`,
          { credentials: "include" }
        );
        if (res.ok) {
          const data = await res.json();
          setRecords(data.logs ?? []);
          setTotal(data.total ?? 0);
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [days, page]);

  const columns = [
    { key: "operation", label: "Operation" },
    {
      key: "provider",
      label: "Provider",
      render: (r: UsageRecord) => (
        <Badge variant="secondary">{r.provider}</Badge>
      ),
    },
    {
      key: "credits_used",
      label: "Credits",
      render: (r: UsageRecord) => r.credits_used,
    },
    {
      key: "user_id",
      label: "User ID",
      render: (r: UsageRecord) => (
        <span className="font-mono text-xs">{r.user_id?.slice(0, 8)}...</span>
      ),
    },
    {
      key: "created_at",
      label: "Date",
      render: (r: UsageRecord) =>
        new Date(r.created_at).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Usage Analytics</h1>

      <div className="flex items-center gap-2">
        {dayOptions.map((d) => (
          <Button
            key={d}
            variant={days === d ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDays(d);
              setPage(1);
            }}
          >
            {d}d
          </Button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={records}
        total={total}
        page={page}
        perPage={20}
        onPageChange={setPage}
        isLoading={loading}
      />
    </div>
  );
}
