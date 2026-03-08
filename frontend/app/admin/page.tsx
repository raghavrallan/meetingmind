"use client";

import { useState, useEffect } from "react";
import { StatCard } from "@/components/admin/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  UserCheck,
  Mic,
  Coins,
  Gift,
  Key,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface Stats {
  total_users: number;
  active_users_7d: number;
  total_meetings: number;
  total_credits_used: number;
  total_credits_granted: number;
  active_keys: number;
}

interface Charts {
  meetings_per_day: { date: string; count: number }[];
  usage_by_operation: { operation: string; credits: number }[];
}

export default function AdminOverviewPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [charts, setCharts] = useState<Charts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, chartsRes] = await Promise.all([
          fetch(`${API_BASE}/api/v1/admin/stats`, { credentials: "include" }),
          fetch(`${API_BASE}/api/v1/admin/stats/charts`, {
            credentials: "include",
          }),
        ]);
        if (statsRes.ok) setStats(await statsRes.json());
        if (chartsRes.ok) setCharts(await chartsRes.json());
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Overview</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Users"
          value={stats?.total_users ?? 0}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Active Users (7d)"
          value={stats?.active_users_7d ?? 0}
          icon={<UserCheck className="h-5 w-5" />}
        />
        <StatCard
          title="Total Meetings"
          value={stats?.total_meetings ?? 0}
          icon={<Mic className="h-5 w-5" />}
        />
        <StatCard
          title="Credits Used"
          value={stats?.total_credits_used ?? 0}
          icon={<Coins className="h-5 w-5" />}
        />
        <StatCard
          title="Credits Granted"
          value={stats?.total_credits_granted ?? 0}
          icon={<Gift className="h-5 w-5" />}
        />
        <StatCard
          title="Active Keys"
          value={stats?.active_keys ?? 0}
          icon={<Key className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Meetings Per Day</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={charts?.meetings_per_day ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Usage by Operation</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts?.usage_by_operation ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="operation"
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar
                    dataKey="credits"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
