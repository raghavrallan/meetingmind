"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { CheckSquare, Clock, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { api, type TeamMember } from "@/lib/api";

export default function TeamPage() {
  const { loading: authLoading } = useAuth();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;

    async function fetchData() {
      try {
        const members = await api.team.list();
        setTeamMembers(members);
      } catch (err) {
        console.error("Failed to fetch team:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [authLoading]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Team</h1>
        <p className="text-muted-foreground">
          View your team members and their current workload
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {teamMembers.map((member) => (
          <Link key={member.id} href={`/team/${member.id}`}>
            <Card className="transition-all hover:shadow-lg hover:bg-accent/30 cursor-pointer h-full">
              <CardContent className="flex flex-col items-center p-6 text-center">
                <Avatar className="h-16 w-16">
                  <AvatarFallback className="text-lg">
                    {getInitials(member.name)}
                  </AvatarFallback>
                </Avatar>
                <h3 className="mt-3 font-semibold">{member.name}</h3>
                {member.role && (
                  <Badge variant="secondary" className="mt-1">
                    {member.role}
                  </Badge>
                )}
                <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CheckSquare className="h-3 w-3" />
                    {member.open_tasks_count ?? 0} open tasks
                  </span>
                </div>
                {member.last_active && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Active
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
        {teamMembers.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full text-center py-8">
            No team members found
          </p>
        )}
      </div>
    </div>
  );
}
