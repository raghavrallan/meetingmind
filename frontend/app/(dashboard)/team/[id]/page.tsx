"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Mail,
  CheckSquare,
  CheckCircle2,
  Mic,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { api, type TeamMember } from "@/lib/api";

export default function MemberProfilePage() {
  const params = useParams();
  const memberId = params.id as string;
  const { loading: authLoading } = useAuth();

  const [member, setMember] = useState<TeamMember | null>(null);
  const [workload, setWorkload] = useState<{ open_tasks: number; completed_tasks: number; meetings_attended: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !memberId) return;

    async function fetchData() {
      try {
        const [profile, wl] = await Promise.all([
          api.team.get(memberId),
          api.team.workload(memberId).catch(() => null),
        ]);
        setMember(profile);
        setWorkload(wl);
      } catch (err) {
        console.error("Failed to fetch member:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [authLoading, memberId]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/team">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <p className="text-muted-foreground">Team member not found.</p>
      </div>
    );
  }

  const openTasks = workload?.open_tasks ?? member.open_tasks_count ?? 0;
  const completedTasks = workload?.completed_tasks ?? 0;
  const meetingsAttended = workload?.meetings_attended ?? member.total_meetings ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/team">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-xl">
              {getInitials(member.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">{member.name}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              {member.email}
            </div>
            {member.role && (
              <Badge variant="secondary" className="mt-1">
                {member.role}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
              <CheckSquare className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{openTasks}</p>
              <p className="text-xs text-muted-foreground">Open Tasks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{completedTasks}</p>
              <p className="text-xs text-muted-foreground">Completed Tasks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Mic className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{meetingsAttended}</p>
              <p className="text-xs text-muted-foreground">
                Meetings Attended
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
