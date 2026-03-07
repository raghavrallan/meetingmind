"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  Edit2,
  Mic,
  Calendar,
  Clock,
  RefreshCw,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { api, getMeetingDate, getMeetingDuration, type Project, type Meeting, type ProjectMember } from "@/lib/api";

function getPriorityBadge(priority: string) {
  switch (priority.toLowerCase()) {
    case "urgent":
      return <Badge className="bg-red-500/10 text-red-500 border-red-500/20">Urgent</Badge>;
    case "high":
      return <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">High</Badge>;
    case "medium":
      return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Medium</Badge>;
    case "low":
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Low</Badge>;
    default:
      return <Badge variant="secondary">{priority}</Badge>;
  }
}

interface ProjectTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee_name?: string;
}

const statusColumns = ["open", "in_progress", "completed"];
const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
};

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { loading: authLoading } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [projectMeetings, setProjectMeetings] = useState<Meeting[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [projectBrief, setProjectBrief] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);

  useEffect(() => {
    if (authLoading || !projectId) return;

    async function fetchData() {
      try {
        const [p, meetings, members] = await Promise.all([
          api.projects.get(projectId),
          api.projects.meetings(projectId).catch(() => []),
          api.projects.members(projectId).catch(() => []),
        ]);
        setProject(p);
        setProjectMeetings(meetings);
        setProjectMembers(members);

        // Fetch tasks for this project
        try {
          const tasks = await api.tasks.list({ project_id: projectId });
          setProjectTasks(tasks);
        } catch {
          // No tasks
        }

        // Fetch brief
        try {
          const brief = await api.projects.brief(projectId);
          setProjectBrief(brief.brief || "");
        } catch {
          // No brief available
        }
      } catch (err) {
        console.error("Failed to fetch project:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [authLoading, projectId]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/projects">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <p className="text-muted-foreground">Project not found.</p>
      </div>
    );
  }

  const handleRegenerate = async () => {
    setIsRegenerating(true);
    try {
      const result = await api.projects.regenerateBrief(projectId);
      setProjectBrief(result.brief || "");
    } catch {
      // Regeneration failed
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/projects">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: project.color }}
            />
            <h1 className="text-2xl font-bold">{project.name}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.description}
          </p>
        </div>
        <Button variant="outline" size="sm">
          <Edit2 className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="meetings">
        <TabsList>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="brief">Brief</TabsTrigger>
        </TabsList>

        {/* Meetings Tab */}
        <TabsContent value="meetings" className="space-y-3">
          {projectMeetings.length > 0 ? (
            projectMeetings.map((meeting) => (
              <Link key={meeting.id} href={`/meetings/${meeting.id}`}>
                <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Mic className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-medium">{meeting.title}</h3>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(getMeetingDate(meeting)), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {Math.round(getMeetingDuration(meeting) / 60)} min
                        </span>
                      </div>
                    </div>
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                      {meeting.status}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No meetings for this project yet.</p>
          )}
        </TabsContent>

        {/* Tasks Tab (Mini Kanban) */}
        <TabsContent value="tasks">
          <div className="grid gap-4 md:grid-cols-3">
            {statusColumns.map((status) => (
              <div key={status} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{statusLabels[status]}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {projectTasks.filter((t) => t.status.toLowerCase() === status).length}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {projectTasks
                    .filter((task) => task.status.toLowerCase() === status)
                    .map((task) => (
                      <Card key={task.id}>
                        <CardContent className="p-3 space-y-2">
                          <p className="text-sm font-medium">{task.title}</p>
                          <div className="flex items-center justify-between">
                            {getPriorityBadge(task.priority)}
                            <span className="text-xs text-muted-foreground">
                              {task.assignee_name || "Unassigned"}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Members Tab */}
        <TabsContent value="members">
          {projectMembers.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projectMembers.map((member) => (
                <Card key={member.id}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback>{getInitials(member.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <h3 className="font-medium">{member.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {member.role}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No members in this project.</p>
          )}
        </TabsContent>

        {/* Brief Tab */}
        <TabsContent value="brief">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>AI-Generated Project Brief</CardTitle>
                <CardDescription>
                  Automatically generated from meeting notes and tasks
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={isRegenerating}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isRegenerating ? "animate-spin" : ""}`}
                />
                Regenerate
              </Button>
            </CardHeader>
            <CardContent>
              {projectBrief ? (
                <div className="prose prose-sm prose-invert max-w-none">
                  {projectBrief.split("\n").map((line, i) => {
                    if (line.startsWith("## ")) {
                      return (
                        <h2 key={i} className="text-lg font-semibold mt-6 mb-2">
                          {line.replace("## ", "")}
                        </h2>
                      );
                    }
                    if (line.startsWith("- **")) {
                      return (
                        <p key={i} className="text-sm ml-4 my-1">
                          {line.replace("- **", "").replace("**", "")}
                        </p>
                      );
                    }
                    if (line.match(/^\d+\. /)) {
                      return (
                        <p key={i} className="text-sm ml-4 my-1">
                          {line}
                        </p>
                      );
                    }
                    if (line.trim() === "") {
                      return <div key={i} className="h-2" />;
                    }
                    return (
                      <p key={i} className="text-sm leading-relaxed my-1">
                        {line}
                      </p>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No brief available. Click Regenerate to create one.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
