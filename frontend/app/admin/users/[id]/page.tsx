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
  status: string;
  suspended_at?: string;
  suspended_reason?: string;
  deleted_at?: string;
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
        `${API_BASE}/api/v1/admin/credits/grant`,
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

  async function handleAction(action: string, body?: object) {
    setActionLoading(action);
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
      if (res.ok) await fetchUser();
    } catch {
      // silently fail
    } finally {
      setActionLoading(null);
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
            <div className="flex items-center gap-2">
              {user.status === "active" && (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                  Active
                </Badge>
              )}
              {user.status === "suspended" && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                  Suspended
                </Badge>
              )}
              {user.status === "deleted" && (
                <Badge variant="destructive">Deleted</Badge>
              )}
            </div>
            {user.status === "suspended" && (
              <div className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  Suspended{user.suspended_at ? ` on ${new Date(user.suspended_at).toLocaleDateString()}` : ""}
                </p>
                {user.suspended_reason && (
                  <p className="mt-1 text-amber-700 dark:text-amber-300">
                    Reason: {user.suspended_reason}
                  </p>
                )}
              </div>
            )}
            {user.status === "deleted" && user.deleted_at && (
              <div className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950">
                <p className="text-red-800 dark:text-red-200">
                  Deleted on {new Date(user.deleted_at).toLocaleDateString()}
                </p>
              </div>
            )}
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

            <div className="mt-4 space-y-2 border-t border-[hsl(var(--border))] pt-4">
              <p className="text-sm font-medium">Actions</p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  handleAction(user.is_admin ? "remove-admin" : "make-admin")
                }
                disabled={actionLoading !== null}
              >
                {actionLoading === "make-admin" || actionLoading === "remove-admin" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4" />
                )}
                {user.is_admin ? "Remove Admin" : "Make Admin"}
              </Button>

              {user.status === "active" && (
                <Button
                  variant="outline"
                  className="w-full border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950"
                  onClick={() => {
                    const reason = window.prompt("Reason for suspension:");
                    if (reason !== null) handleAction("suspend", { reason });
                  }}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "suspend" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Suspend User
                </Button>
              )}

              {user.status === "suspended" && (
                <Button
                  variant="outline"
                  className="w-full border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400 dark:hover:bg-green-950"
                  onClick={() => handleAction("reactivate")}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "reactivate" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Reactivate User
                </Button>
              )}

              {user.status !== "deleted" && (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => {
                    if (window.confirm("Are you sure you want to delete this user?"))
                      handleAction("delete");
                  }}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "delete" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Delete User
                </Button>
              )}

              {user.status === "deleted" && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleAction("restore")}
                  disabled={actionLoading !== null}
                >
                  {actionLoading === "restore" && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Restore User
                </Button>
              )}
            </div>
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
