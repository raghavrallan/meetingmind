"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import {
  Mic,
  Plus,
  Search,
  Calendar,
  Clock,
  Filter,
  FileText,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/hooks/use-auth";
import { api, getMeetingDate, getMeetingDuration, getParticipantName, type Meeting, type Project } from "@/lib/api";

function getStatusBadge(status: string) {
  switch (status.toLowerCase()) {
    case "completed":
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Completed</Badge>;
    case "processing":
      return <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20">Processing</Badge>;
    case "recording":
      return (
        <Badge className="gap-1 bg-red-500/10 text-red-500 border-red-500/20">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          Live
        </Badge>
      );
    case "scheduled":
      return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Scheduled</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}m` : `${hrs}h`;
}

export default function MeetingsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
      <MeetingsContent />
    </Suspense>
  );
}

function MeetingsContent() {
  const { token, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const urlSearch = searchParams.get("search") || "";

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(urlSearch);
  const [selectedProject, setSelectedProject] = useState("all");

  // Sync URL search param into local state
  useEffect(() => {
    if (urlSearch) setSearchQuery(urlSearch);
  }, [urlSearch]);

  useEffect(() => {
    if (!token) return;

    async function fetchData() {
      try {
        const params: { search?: string } = {};
        if (searchQuery) params.search = searchQuery;
        const [m, p] = await Promise.all([
          api.meetings.list(token, params),
          api.projects.list(token),
        ]);
        setMeetings(m);
        setProjects(p);
      } catch (err) {
        console.error("Failed to fetch meetings:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [token, searchQuery]);

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const filteredMeetings = meetings.filter((meeting) => {
    const matchesSearch =
      !searchQuery ||
      meeting.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProject =
      selectedProject === "all" || meeting.project_id === selectedProject;
    return matchesSearch && matchesProject;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meetings</h1>
          <p className="text-muted-foreground">
            View and manage your recorded meetings
          </p>
        </div>
        <Button asChild>
          <Link href="/meetings/live">
            <Plus className="mr-2 h-4 w-4" />
            New Meeting
          </Link>
        </Button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search meetings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={selectedProject} onValueChange={setSelectedProject}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Filter by project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Meetings List */}
      {filteredMeetings.length > 0 ? (
        <div className="space-y-3">
          {filteredMeetings.map((meeting) => {
            const isLive = meeting.status.toLowerCase() === "recording";
            return (
              <Link
                key={meeting.id}
                href={isLive ? `/meetings/${meeting.id}` : `/meetings/${meeting.id}`}
              >
                <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      {isLive ? (
                        <Mic className="h-5 w-5 text-red-500 animate-pulse" />
                      ) : (
                        <Mic className="h-5 w-5 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{meeting.title}</h3>
                        {meeting.project_id && projectMap[meeting.project_id] && (
                          <Badge variant="secondary" className="text-xs">
                            {projectMap[meeting.project_id]}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(getMeetingDate(meeting)), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                        {!isLive && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(getMeetingDuration(meeting))}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {meeting.participants && meeting.participants.length > 0 && (
                        <div className="flex -space-x-2">
                          {meeting.participants.slice(0, 3).map((p, i) => (
                            <Avatar
                              key={i}
                              className="h-7 w-7 border-2 border-card"
                            >
                              <AvatarFallback className="text-[10px]">
                                {getParticipantName(p)
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                          {meeting.participants.length > 3 && (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-medium">
                              +{meeting.participants.length - 3}
                            </div>
                          )}
                        </div>
                      )}
                      {getStatusBadge(meeting.status)}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <FileText className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mt-4 text-lg font-medium">No meetings found</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {searchQuery || selectedProject !== "all"
                ? "Try adjusting your filters to find what you are looking for."
                : "Start your first meeting to see it here."}
            </p>
            <Button className="mt-4" asChild>
              <Link href="/meetings/live">
                <Mic className="mr-2 h-4 w-4" />
                Start New Meeting
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
