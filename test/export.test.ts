import { describe, it, expect } from "vitest";
import { mindmapExportPath } from "../src/graph";

describe("mindmapExportPath", () => {
  it("puts the .html next to the note, dropping the .md", () => {
    expect(mindmapExportPath("folder/Note.md")).toBe(
      "folder/Note mindmap.html"
    );
  });
  it("handles a note in the vault root", () => {
    expect(mindmapExportPath("Note.md")).toBe("Note mindmap.html");
  });
  it("strips only the trailing .md, keeping dots in the name", () => {
    expect(mindmapExportPath("d/My.Notes.md")).toBe("d/My.Notes mindmap.html");
  });
  it("keeps nested folders", () => {
    expect(mindmapExportPath("a/b/c/N.md")).toBe("a/b/c/N mindmap.html");
  });
});
