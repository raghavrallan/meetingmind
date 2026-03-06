"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Mic,
  FolderKanban,
  CheckSquare,
  Clock,
  Plus,
  ArrowRight,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/hooks/use-auth";
import { api, getMeetingDate, getMeetingDuration, getParticipantName, type Meeting, type Project, type Task } from "@/lib/api";

function StatCard({
  title,
  value,
  icon: Icon,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

function formatMeetingDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
}

export default function DashboardPage() {
  const { token, user, loading: authLoading } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;

    async function fetchData() {
      try {
        const [m, p, t] = await Promise.all([
          api.meetings.list(token),
          api.projects.list(token),
          api.tasks.list(token),
        ]);
        setMeetings(m);
        setProjects(p);
        setTasks(t);
      } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [token]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalMeetings = meetings.length;
  const activeProjects = projects.length;
  const openTasks = tasks.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const hoursRecorded = meetings.reduce((sum, m) => sum + getMeetingDuration(m), 0) / 3600;

  const recentMeetings = [...meetings]
    .sort((a, b) => new Date(getMeetingDate(b)).getTime() - new Date(getMeetingDate(a)).getTime())
    .slice(0, 5);

  const overdueTasks = tasks.filter(
    (t) => t.due_date && new Date(t.due_date) < new Date() && t.status !== "completed" && t.status !== "cancelled"
  ).length;

  const userName = user?.name?.split(" ")[0] || "User";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, {userName}
        </h1>
        <p className="text-muted-foreground">
          Here is an overview of your meetings, projects, and tasks.
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Meetings"
          value={totalMeetings}
          icon={Mic}
        />
        <StatCard
          title="Active Projects"
          value={activeProjects}
          icon={FolderKanban}
        />
        <StatCard
          title="Open Tasks"
          value={openTasks}
          icon={CheckSquare}
          description={overdueTasks > 0 ? `${overdueTasks} overdue` : undefined}
        />
        <StatCard
          title="Hours Recorded"
          value={`${hoursRecorded.toFixed(1)}h`}
          icon={Clock}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Meetings */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Meetings</CardTitle>
              <CardDescription>Your latest recorded meetings</CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/meetings">
                View all <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentMeetings.length > 0 ? (
              <div className="space-y-3">
                {recentMeetings.map((meeting) => (
                  <Link
                    key={meeting.id}
                    href={`/meetings/${meeting.id}`}
                    className="flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-accent"
                  >
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">
                        {meeting.title}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {format(new Date(getMeetingDate(meeting)), "MMM d, h:mm a")}
                        </span>
                        <span>-</span>
                        <span>{formatMeetingDuration(getMeetingDuration(meeting))}</span>
                      </div>
                    </div>
                    {meeting.participants && meeting.participants.length > 0 && (
                      <div className="flex -space-x-2">
                        {meeting.participants.slice(0, 3).map((p, i) => (
                          <Avatar key={i} className="h-6 w-6 border-2 border-card">
                            <AvatarFallback className="text-[10px]">
                              {getParticipantName(p)[0]}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {meeting.participants.length > 3 && (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px]">
                            +{meeting.participants.length - 3}
                          </div>
                        )}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">No meetings yet</p>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-6">
          {/* Task Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Task Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {overdueTasks > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {overdueTasks} overdue task{overdueTasks !== 1 ? "s" : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Require immediate attention
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/tasks">View</Link>
                  </Button>
                </div>
              )}
              {openTasks > 0 && (
                <div className="flex items-center gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
                  <Clock className="h-5 w-5 text-yellow-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {openTasks} open task{openTasks !== 1 ? "s" : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Stay on track with deadlines
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/tasks">View</Link>
                  </Button>
                </div>
              )}
              {openTasks === 0 && overdueTasks === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">All caught up!</p>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-3">
              <Button asChild className="flex-1">
                <Link href="/meetings/live">
                  <Mic className="mr-2 h-4 w-4" />
                  Start New Meeting
                </Link>
              </Button>
              <Button variant="outline" asChild className="flex-1">
                <Link href="/projects">
                  <Plus className="mr-2 h-4 w-4" />
                  Create Project
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
