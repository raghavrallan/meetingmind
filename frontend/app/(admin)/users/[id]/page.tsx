"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, ArrowLeft } from "lucide-react";
import Link from "next/link";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface UserDetail {
  id: string;
  name: string;
  email: string;
  auth_provider: string;
  credit_balance: number;
  lifetime_credits: number;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
  recent_transactions: Transaction[];
  recent_usage: UsageRecord[];
}

interface Transaction {
  id: string;
  amount: number;
  balance_after: number;
  transaction_type: string;
  description: string;
  created_at: string;
}

interface UsageRecord {
  id: string;
  operation: string;
  provider: string;
  credits_used: number;
  created_at: string;
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const userId = params.id as string;
  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [grantAmount, setGrantAmount] = useState("");
  const [grantDescription, setGrantDescription] = useState("");
  const [granting, setGranting] = useState(false);
  const [toggling, setToggling] = useState(false);

  async function fetchUser() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/users/${userId}`, {
        credentials: "include",
      });
      if (res.ok) setUser(await res.json());
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUser();
  }, [userId]);

  async function handleGrant() {
    if (!grantAmount) return;
    setGranting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/settings/admin/credits/grant`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: userId,
            amount: Number(grantAmount),
            description: grantDescription || "Admin grant",
          }),
        }
      );
      if (res.ok) {
        setGrantAmount("");
        setGrantDescription("");
        await fetchUser();
      }
    } catch {
      // silently fail
    } finally {
      setGranting(false);
    }
  }

  async function handleToggleAdmin() {
    if (!user) return;
    setToggling(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/users/${userId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_admin: !user.is_admin }),
      });
      if (res.ok) await fetchUser();
    } catch {
      // silently fail
    } finally {
      setToggling(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        User not found
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/users">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">User Detail</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="font-medium">{user.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Email</span>
              <span>{user.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Provider</span>
              <Badge variant="secondary">{user.auth_provider}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Role</span>
              {user.is_admin ? (
                <Badge>Admin</Badge>
              ) : (
                <span className="text-sm">User</span>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Joined</span>
              <span className="text-sm">
                {new Date(user.created_at).toLocaleDateString()}
              </span>
            </div>
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={handleToggleAdmin}
              disabled={toggling}
            >
              {toggling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Shield className="h-4 w-4" />
              )}
              {user.is_admin ? "Remove Admin" : "Make Admin"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Balance</span>
              <span className="text-xl font-bold">
                {user.credit_balance?.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Lifetime</span>
              <span>{user.lifetime_credits?.toLocaleString()}</span>
            </div>
            <div className="space-y-2 border-t border-[hsl(var(--border))] pt-4">
              <p className="text-sm font-medium">Grant Credits</p>
              <Input
                type="number"
                placeholder="Amount"
                value={grantAmount}
                onChange={(e) => setGrantAmount(e.target.value)}
              />
              <Input
                placeholder="Description (optional)"
                value={grantDescription}
                onChange={(e) => setGrantDescription(e.target.value)}
              />
              <Button
                className="w-full"
                onClick={handleGrant}
                disabled={granting || !grantAmount}
              >
                {granting && <Loader2 className="h-4 w-4 animate-spin" />}
                Grant Credits
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {user.recent_transactions?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Amount
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Balance After
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Type
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Description
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {user.recent_transactions.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b border-[hsl(var(--border))]"
                    >
                      <td className="px-4 py-2">
                        <span
                          className={
                            t.amount > 0 ? "text-green-500" : "text-red-500"
                          }
                        >
                          {t.amount > 0 ? "+" : ""}
                          {t.amount}
                        </span>
                      </td>
                      <td className="px-4 py-2">{t.balance_after}</td>
                      <td className="px-4 py-2">
                        <Badge variant="secondary">{t.transaction_type}</Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {t.description}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {user.recent_usage?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[hsl(var(--border))]">
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Operation
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Provider
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Credits
                    </th>
                    <th className="px-4 py-2 text-left text-muted-foreground">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {user.recent_usage.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-[hsl(var(--border))]"
                    >
                      <td className="px-4 py-2">{u.operation}</td>
                      <td className="px-4 py-2">
                        <Badge variant="secondary">{u.provider}</Badge>
                      </td>
                      <td className="px-4 py-2">{u.credits_used}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
