import type { MapCfg, NoteLike, Resolver } from "../src/graph";

// build a NoteLike from a path; basename = filename without .md
export const mk = (
  path: string,
  frontmatter: Record<string, any> = {}
): NoteLike => ({
  path,
  basename: path.replace(/^.*\//, "").replace(/\.md$/, ""),
  frontmatter,
});

// an Obsidian-style resolver backed by an in-memory note list (basename match)
export const resolverFor =
  (notes: NoteLike[]): Resolver =>
  (key) =>
    notes.find((n) => n.basename === key)?.path ?? null;

// the handoff's sketch vault: goals -> projects -> tasks
export const simpleNotes: NoteLike[] = [
  mk("g/Goal A.md", { title: "Goal A", kpi: "north star" }),
  mk("p/Proj 1.md", { title: "Proj 1", goal: "[[Goal A]]", status: "wip" }),
  mk("t/T1.md", {
    title: "T1",
    project: "[[Proj 1]]",
    status: "done",
    progress: 100,
  }),
];
// pm-task-shaped notes modeled on the real 2026 Roadmap_tasks files: status /
// start / due / progress / parentId (+ an `id` the parentId links point at).
export const taskNotes: NoteLike[] = [
  mk("tasks/broker-operator.md", {
    id: "p-broker",
    title: "Broker operator",
    parentId: "",
    status: "in-progress",
    priority: "high",
    start: "2026-06-09",
    due: "2026-08-16",
    progress: 30,
    tags: ["product"],
  }),
  mk("tasks/broker-phase-1.md", {
    id: "p-broker-1",
    title: "Broker operator · Phase 1",
    parentId: "p-broker",
    status: "in-progress",
    start: "2026-06-09",
    due: "2026-07-18",
    progress: 57,
    tags: ["product"],
  }),
  mk("tasks/client-dns.md", {
    id: "t-dns",
    title: "Client go-live DNS",
    parentId: "",
    status: "done",
    start: "2025-12-01",
    due: "2026-06-26",
    progress: 100,
    tags: ["devops"],
  }),
  mk("tasks/kickoff.md", {
    // milestone: start == due
    id: "t-kickoff",
    title: "Kickoff",
    parentId: "",
    status: "todo",
    start: "2026-06-15",
    due: "2026-06-15",
    tags: ["product"],
  }),
  mk("tasks/someday.md", {
    // no dates at all: a row without a bar
    id: "t-someday",
    title: "Someday",
    parentId: "",
    status: "todo",
    tags: ["product"],
  }),
];

export const taskCfg: MapCfg = {
  levels: [
    {
      id: "top",
      from: "tasks",
      label: "TASKS",
      where: { parentId: null },
      card: { title: "title", meta: ["status"], progress: "progress" },
    },
    {
      id: "sub",
      from: "tasks",
      card: { title: "title", progress: "progress" },
    },
  ],
  edges: [{ from: "top", to: "sub", via: "parentId" }],
  filter: ["status", "tags"],
  gantt: { start: "start", end: "due" },
  kanban: { groupBy: "status" },
};

export const simpleCfg: MapCfg = {
  levels: [
    {
      id: "goals",
      from: "g",
      label: "GOALS",
      card: { title: "title", sub: "kpi" },
    },
    {
      id: "projects",
      from: "p",
      label: "PROJECTS",
      card: { title: "title", meta: ["status"] },
    },
    {
      id: "tasks",
      from: "t",
      label: "TASKS",
      card: { title: "title", meta: ["status"], progress: "progress" },
    },
  ],
  edges: [
    { from: "goals", to: "projects", via: "goal" },
    { from: "projects", to: "tasks", via: "project" },
  ],
  filter: ["status"],
};
