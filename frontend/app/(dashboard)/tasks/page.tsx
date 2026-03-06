"use client";

import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import {
  Plus,
  Filter,
  GripVertical,
  Calendar,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils";
import { useAuth } from "@/lib/hooks/use-auth";
import { api, type Task, type Project } from "@/lib/api";

const columns = [
  { id: "open", label: "Open", color: "bg-blue-500" },
  { id: "in_progress", label: "In Progress", color: "bg-yellow-500" },
  { id: "completed", label: "Completed", color: "bg-green-500" },
  { id: "cancelled", label: "Cancelled", color: "bg-gray-500" },
];

function getPriorityBadge(priority: string) {
  const styles: Record<string, string> = {
    urgent: "bg-red-500/10 text-red-500 border-red-500/20",
    high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    low: "bg-green-500/10 text-green-500 border-green-500/20",
  };
  return <Badge className={cn("text-xs", styles[priority.toLowerCase()])}>{priority}</Badge>;
}

export default function TasksPage() {
  const { token, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState("medium");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    async function fetchData() {
      try {
        const [board, projects] = await Promise.all([
          api.tasks.board(token).catch(() => null),
          api.projects.list(token).catch(() => []),
        ]);
        setProjectList(projects);
        if (board) {
          const allTasks = [
            ...(board.open || []),
            ...(board.in_progress || []),
            ...(board.completed || []),
            ...(board.cancelled || []),
          ];
          setTasks(allTasks);
        } else {
          const list = await api.tasks.list(token);
          setTasks(list);
        }
      } catch (err) {
        console.error("Failed to fetch tasks:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [token]);

  const projectMap = Object.fromEntries(projectList.map((p) => [p.id, p.name]));
  const getProjectName = (task: Task) => task.project_id ? projectMap[task.project_id] || null : null;

  const projects = Array.from(
    new Set(tasks.map((t) => getProjectName(t)).filter(Boolean))
  );
  const assignees = Array.from(
    new Set(tasks.map((t) => t.assignee_name).filter(Boolean))
  );

  const filteredTasks = tasks.filter((task) => {
    if (projectFilter !== "all" && getProjectName(task) !== projectFilter)
      return false;
    if (assigneeFilter !== "all" && task.assignee_name !== assigneeFilter)
      return false;
    if (priorityFilter !== "all" && task.priority.toLowerCase() !== priorityFilter)
      return false;
    return true;
  });

  const handleDragStart = useCallback((taskId: string) => {
    setDraggedTaskId(taskId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(
    async (status: string) => {
      if (!draggedTaskId || !token) return;
      // Optimistic update
      setTasks((prev) =>
        prev.map((task) =>
          task.id === draggedTaskId ? { ...task, status: status as Task["status"] } : task
        )
      );
      setDraggedTaskId(null);
      // API call
      try {
        await api.tasks.update(token, draggedTaskId, { status });
      } catch (err) {
        console.error("Failed to update task status:", err);
      }
    },
    [draggedTaskId, token]
  );

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !token) return;
    try {
      const created = await api.tasks.create(token, {
        title: newTaskTitle,
        priority: newTaskPriority as Task["priority"],
        status: "open",
      });
      setTasks((prev) => [...prev, created]);
      setNewTaskTitle("");
      setNewTaskPriority("medium");
      setDialogOpen(false);
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground">
            Manage and track tasks extracted from meetings
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Task</DialogTitle>
              <DialogDescription>
                Add a new task to the board.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <Input
                  placeholder="Task title"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select
                  value={newTaskPriority}
                  onValueChange={setNewTaskPriority}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateTask}
                disabled={!newTaskTitle.trim()}
              >
                Create Task
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-[180px]">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p!} value={p!}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assignees</SelectItem>
            {assignees.map((a) => (
              <SelectItem key={a!} value={a!}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Priorities</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Kanban Board */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {columns.map((column) => {
          const columnTasks = filteredTasks.filter(
            (t) => t.status.toLowerCase() === column.id
          );
          return (
            <div
              key={column.id}
              className="flex flex-col"
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(column.id)}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={cn("h-2 w-2 rounded-full", column.color)} />
                  <h3 className="text-sm font-semibold">{column.label}</h3>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {columnTasks.length}
                </Badge>
              </div>

              <div className="flex-1 space-y-2 rounded-lg bg-muted/30 p-2 min-h-[200px]">
                {columnTasks.map((task) => (
                  <Card
                    key={task.id}
                    draggable
                    onDragStart={() => handleDragStart(task.id)}
                    className={cn(
                      "cursor-grab active:cursor-grabbing transition-all",
                      draggedTaskId === task.id && "opacity-50"
                    )}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <p className="text-sm font-medium flex-1">
                          {task.title}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        {getPriorityBadge(task.priority)}
                        {task.assignee_name && (
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-[10px]">
                              {getInitials(task.assignee_name)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {task.due_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {format(new Date(task.due_date), "MMM d")}
                          </span>
                        )}
                        {getProjectName(task) && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {getProjectName(task)}
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {columnTasks.length === 0 && (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    No tasks
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
