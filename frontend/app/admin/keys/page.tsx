"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost";

interface PlatformKey {
  key_name: string;
  provider: string;
  is_active: boolean;
  created_at: string;
  last_used_at?: string;
}

export default function AdminKeysPage() {
  const [keys, setKeys] = useState<PlatformKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ key_name: "", provider: "", value: "" });
  const [submitting, setSubmitting] = useState(false);

  async function fetchKeys() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/platform-keys`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(Array.isArray(data) ? data : []);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchKeys();
  }, []);

  async function handleAdd() {
    if (!form.key_name || !form.provider || !form.value) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/platform-keys`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setForm({ key_name: "", provider: "", value: "" });
        setDialogOpen(false);
        await fetchKeys();
      }
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(keyName: string) {
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/admin/platform-keys/${keyName}`,
        { method: "DELETE", credentials: "include" }
      );
      if (res.ok) await fetchKeys();
    } catch {
      // silently fail
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">API Keys</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Platform Key</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <Input
                placeholder="Key name (e.g. OPENAI_API_KEY)"
                value={form.key_name}
                onChange={(e) =>
                  setForm({ ...form, key_name: e.target.value })
                }
              />
              <Input
                placeholder="Provider (e.g. openai, deepgram)"
                value={form.provider}
                onChange={(e) =>
                  setForm({ ...form, provider: e.target.value })
                }
              />
              <Input
                placeholder="API Key value"
                type="password"
                value={form.value}
                onChange={(e) =>
                  setForm({ ...form, value: e.target.value })
                }
              />
              <Button
                className="w-full"
                onClick={handleAdd}
                disabled={submitting || !form.key_name || !form.provider || !form.value}
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Add Key
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Key Name
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Provider
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Created
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Last Used
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-muted-foreground"
                    >
                      No API keys configured
                    </td>
                  </tr>
                ) : (
                  keys.map((k) => (
                    <tr
                      key={k.key_name}
                      className="border-b border-[hsl(var(--border))] transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {k.key_name}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{k.provider}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={k.is_active ? "default" : "destructive"}
                          className={
                            k.is_active
                              ? "bg-green-600 hover:bg-green-600"
                              : ""
                          }
                        >
                          {k.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(k.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {k.last_used_at
                          ? new Date(k.last_used_at).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(k.key_name)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
