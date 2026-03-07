"use client";

import { useState, useEffect } from "react";
import { StatCard } from "@/components/admin/stat-card";
import { DataTable } from "@/components/admin/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Coins, TrendingDown } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface Transaction {
  id: string;
  user_id: string;
  user_name?: string;
  amount: number;
  balance_after: number;
  transaction_type: string;
  description: string;
  created_at: string;
}

interface Summary {
  total_granted: number;
  total_used: number;
}

export default function AdminCreditsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary>({
    total_granted: 0,
    total_used: 0,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [grantUserId, setGrantUserId] = useState("");
  const [grantAmount, setGrantAmount] = useState("");
  const [grantDescription, setGrantDescription] = useState("");
  const [granting, setGranting] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        days: "30",
        page: String(page),
        per_page: "20",
      });
      const res = await fetch(
        `${API_BASE}/api/v1/admin/credits/transactions?${params}`,
        { credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions ?? []);
        setTotal(data.total ?? 0);
        if (data.summary) setSummary(data.summary);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, [page]);

  async function handleGrant() {
    if (!grantUserId || !grantAmount) return;
    setGranting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/settings/admin/credits/grant`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: grantUserId,
            amount: Number(grantAmount),
            description: grantDescription || "Admin grant",
          }),
        }
      );
      if (res.ok) {
        setGrantUserId("");
        setGrantAmount("");
        setGrantDescription("");
        await fetchData();
      }
    } catch {
      // silently fail
    } finally {
      setGranting(false);
    }
  }

  function typeBadgeVariant(type: string) {
    switch (type) {
      case "grant":
      case "signup_bonus":
        return "default" as const;
      case "usage":
      case "deduction":
        return "destructive" as const;
      default:
        return "secondary" as const;
    }
  }

  const columns = [
    {
      key: "user_name",
      label: "User",
      render: (t: Transaction) =>
        t.user_name ?? (
          <span className="font-mono text-xs">
            {t.user_id?.slice(0, 8)}...
          </span>
        ),
    },
    {
      key: "amount",
      label: "Amount",
      render: (t: Transaction) => (
        <span className={t.amount > 0 ? "text-green-500" : "text-red-500"}>
          {t.amount > 0 ? "+" : ""}
          {t.amount}
        </span>
      ),
    },
    {
      key: "balance_after",
      label: "Balance After",
      render: (t: Transaction) => t.balance_after?.toLocaleString(),
    },
    {
      key: "transaction_type",
      label: "Type",
      render: (t: Transaction) => (
        <Badge variant={typeBadgeVariant(t.transaction_type)}>
          {t.transaction_type}
        </Badge>
      ),
    },
    {
      key: "description",
      label: "Description",
      render: (t: Transaction) => (
        <span className="text-muted-foreground">{t.description}</span>
      ),
    },
    {
      key: "created_at",
      label: "Date",
      render: (t: Transaction) =>
        new Date(t.created_at).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Credits & Billing</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          title="Total Granted"
          value={summary.total_granted?.toLocaleString()}
          icon={<Coins className="h-5 w-5" />}
        />
        <StatCard
          title="Total Used"
          value={summary.total_used?.toLocaleString()}
          icon={<TrendingDown className="h-5 w-5" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Grant Credits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">User ID</label>
              <Input
                placeholder="User ID"
                value={grantUserId}
                onChange={(e) => setGrantUserId(e.target.value)}
                className="w-64"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Amount</label>
              <Input
                type="number"
                placeholder="Amount"
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                Description
              </label>
              <Input
                placeholder="Description (optional)"
                value={grantDescription}
                onChange={(e) => setGrantDescription(e.target.value)}
                className="w-64"
              />
            </div>
            <Button
              onClick={handleGrant}
              disabled={granting || !grantUserId || !grantAmount}
            >
              {granting && <Loader2 className="h-4 w-4 animate-spin" />}
              Grant
            </Button>
          </div>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={transactions}
        total={total}
        page={page}
        perPage={20}
        onPageChange={setPage}
        isLoading={loading}
      />
    </div>
  );
}
