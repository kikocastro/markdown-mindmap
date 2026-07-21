import { describe, it, expect } from "vitest";
import {
  collectNodes,
  buildEdges,
  initialView,
  upsertView,
} from "../src/graph";
import type { MapCfg, SavedViewCfg } from "../src/graph";
import { mk, resolverFor, taskCfg, taskNotes } from "./fixtures";

// a saved view = filters + view mode, so "devops · gantt" can pin both. The
// existing list ops carry the extra key through untouched.

describe("SavedViewCfg.view", () => {
  it("upsertView keeps the view mode on the stored view", () => {
    const v: SavedViewCfg = {
      name: "devops · gantt",
      filters: { tags: ["devops"] },
      view: "gantt",
    };
    const next = upsertView([], v);
    expect(next[0].view).toBe("gantt");
    // replacing in place keeps the newest mode
    const replaced = upsertView(next, { ...v, view: "kanban" });
    expect(replaced[0].view).toBe("kanban");
  });

  it("initialView returns the saved view including its mode", () => {
    const cfg: MapCfg = {
      levels: [],
      views: [{ name: "board", filters: {}, view: "kanban" }],
      activeView: "board",
    };
    expect(initialView(cfg)?.view).toBe("kanban");
  });
});

describe("edge resolution by frontmatter id", () => {
  it("resolves a `via` value against the target level's `id` frontmatter", () => {
    // parentId: "p-broker" matches no basename or title, only the id field
    const { nodes, byLevel } = collectNodes(taskCfg, taskNotes);
    buildEdges(taskCfg, nodes, byLevel, resolverFor(taskNotes));
    expect(nodes["tasks/broker-phase-1.md"].primaryParent).toBe(
      "tasks/broker-operator.md"
    );
  });

  it("keeps basename and title resolution taking precedence over id", () => {
    const notes = [
      mk("g/Target.md", { title: "Target", id: "clash" }),
      mk("g/Other.md", { title: "Other title", id: "Target" }),
      mk("p/Child.md", { title: "Child", goal: "Target" }),
    ];
    const cfg: MapCfg = {
      levels: [
        { id: "goals", from: "g", card: { title: "title" } },
        { id: "projects", from: "p", card: { title: "title" } },
      ],
      edges: [{ from: "goals", to: "projects", via: "goal" }],
    };
    const { nodes, byLevel } = collectNodes(cfg, notes);
    buildEdges(cfg, nodes, byLevel);
    // basename "Target" wins over Other.md's id: "Target"
    expect(nodes["p/Child.md"].primaryParent).toBe("g/Target.md");
  });
});
