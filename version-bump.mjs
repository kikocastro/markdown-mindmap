// Keeps manifest.json + versions.json in sync with package.json on `npm version`.
// Wired via the package.json "version" script, so a single `npm version <x>`
// bumps all three files and stages them into the version commit. Prevents the
// "manifest forgot to bump" failure that stops Obsidian from seeing an update.
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;
if (!targetVersion)
  throw new Error("npm_package_version not set; run via npm version");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");
