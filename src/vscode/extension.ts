import * as vscode from "vscode";
import { parse as parseYaml } from "yaml";
import {
  MapCfg,
  NoteLike,
  RenderModel,
  Resolver,
  buildRenderModel,
  validateConfig,
} from "../graph";

// ============================================================================
// Markdown Mindmap — VS Code adapter. Reuses the pure core (../graph). Reads the
// workspace's markdown frontmatter, runs the same layout the Obsidian adapter
// does, and renders the result in a webview. Click a card to open the note.
// Config comes from a ```mindmap fenced block in the active markdown file.
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("markdownMindmap.open", () =>
      openMap(context)
    )
  );
}

export function deactivate() {}

async function openMap(context: vscode.ExtensionContext) {
  const ed = vscode.window.activeTextEditor;
  if (!ed || ed.document.languageId !== "markdown") {
    vscode.window.showErrorMessage(
      "Markdown Mindmap: open a markdown note with a ```mindmap block first."
    );
    return;
  }
  const block = extractMindmapBlock(ed.document.getText());
  if (!block) {
    vscode.window.showErrorMessage(
      "Markdown Mindmap: no ```mindmap block found in this note."
    );
    return;
  }
  let cfg: MapCfg;
  try {
    cfg = parseYaml(block) as MapCfg;
    validateConfig(cfg);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage("Markdown Mindmap config error: " + message);
    return;
  }

  // workspace markdown -> NoteLike[] (path is workspace-relative, the node id)
  const uris = await vscode.workspace.findFiles(
    "**/*.md",
    "**/node_modules/**"
  );
  const notes: NoteLike[] = [];
  const fsPathByRel: Record<string, string> = {};
  for (const uri of uris) {
    const rel = vscode.workspace.asRelativePath(uri, false);
    const text = new TextDecoder("utf8").decode(
      await vscode.workspace.fs.readFile(uri)
    );
    notes.push({
      path: rel,
      basename: rel.replace(/^.*\//, "").replace(/\.md$/, ""),
      frontmatter: parseFrontmatter(text),
    });
    fsPathByRel[rel] = uri.fsPath;
  }

  // no vault link API here: resolve links by basename, then by `title` frontmatter
  const resolver: Resolver = (key) => {
    const hit = notes.find(
      (n) =>
        n.basename === key ||
        (typeof n.frontmatter.title === "string" &&
          n.frontmatter.title.trim() === key)
    );
    return hit ? hit.path : null;
  };

  // the shared core computes the whole drawable model; the webview only renders it
  const payload: RenderModel = buildRenderModel(cfg, notes, resolver);

  const panel = vscode.window.createWebviewPanel(
    "markdownMindmap",
    payload.title || "Markdown Mindmap",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      // only the bundled webview script is ever loaded; keep the webview off the rest of the disk
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    }
  );
  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js")
  );
  panel.webview.html = htmlShell(panel.webview, scriptUri, payload);
  panel.webview.onDidReceiveMessage((msg: { type?: string; path?: string }) => {
    if (
      msg.type === "open" &&
      typeof msg.path === "string" &&
      Object.prototype.hasOwnProperty.call(fsPathByRel, msg.path)
    ) {
      vscode.window.showTextDocument(vscode.Uri.file(fsPathByRel[msg.path]), {
        preview: false,
      });
    }
  });
}

// the first ```mindmap fenced block's body, or null
function extractMindmapBlock(md: string): string | null {
  const m = md.match(/```mindmap[ \t]*\r?\n([\s\S]*?)\r?\n```/);
  return m ? m[1] : null;
}

// leading --- ... --- YAML frontmatter, or {} when absent/invalid
function parseFrontmatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  try {
    const fm: unknown = parseYaml(m[1]);
    return fm && typeof fm === "object" ? (fm as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function htmlShell(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  payload: RenderModel
): string {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};`;
  // JSON is valid JS, so assign it directly; escape < so a string value can't close the <script> tag
  const data = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  html, body { height: 100%; margin: 0; }
  body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); overflow: hidden; }
  #stage { position: absolute; inset: 0; cursor: grab; }
  #stage.drag { cursor: grabbing; }
  svg { width: 100%; height: 100%; display: block; }
  .mm-colhead { fill: var(--vscode-descriptionForeground); font: 700 14px var(--vscode-font-family); }
  .mm-link { fill: none; opacity: .35; }
  .mm-link.mm-also { stroke-dasharray: 5 5; opacity: .2; }
  .mm-node { cursor: pointer; }
  .mm-box { fill: var(--vscode-editorWidget-background); stroke-width: 1.5; }
  .mm-t1 { font: 700 12px var(--vscode-font-family); fill: var(--vscode-editor-foreground); }
  .mm-t2 { font: 10.5px var(--vscode-font-family); fill: var(--vscode-descriptionForeground); }
  .mm-meta { font: 9.5px var(--vscode-font-family); fill: var(--vscode-descriptionForeground); }
  .mm-label { fill: var(--vscode-badge-background); stroke: var(--vscode-widget-border); }
  .mm-label-t { font: 600 9px var(--vscode-font-family); fill: var(--vscode-badge-foreground); text-anchor: middle; }
  .mm-track { fill: var(--vscode-widget-border); }
  .mm-barlbl { font: 700 9px var(--vscode-font-family); fill: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div id="stage"><svg></svg></div>
<script nonce="${nonce}">window.__mmPayload = ${data};</script>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}
