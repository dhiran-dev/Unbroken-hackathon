/**
 * Path-traversal safety tests for the judge artifact reader (Agent A12).
 *
 * The /judge page reads arbitrary-named files from artifacts/. These tests pin
 * the safety contract: hostile names can never escape the artifacts root, and
 * reads never execute content.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ArtifactNotFoundError,
  ArtifactPathError,
  defaultArtifactsRoot,
  listArtifacts,
  readArtifactJson,
  readArtifactText,
  resolveArtifactPath,
} from "@/server/judge/artifacts";

function makeRoot(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "judge-artifacts-"));
  fs.mkdirSync(path.join(root, "scraper"), { recursive: true });
  fs.mkdirSync(path.join(root, "demo"), { recursive: true });
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe("resolveArtifactPath — path traversal is rejected", () => {
  const HOSTILE_NAMES = [
    "../secret.json",
    "../../secret.json",
    "../../../etc/passwd",
    "..%2F..%2Fsecret.json",
    "scraper/../../secret.json",
    "a/b.json",
    "a\\b.json",
    "..\\..\\secret.json",
    "/etc/passwd",
    "C:\\Windows\\system32\\config",
    ".",
    "..",
    ".../",
    ".hidden",
    "",
    "file\u0000.json",
    "file.json/../../escape",
    "con.json ",
  ];

  it.each(HOSTILE_NAMES)("rejects %j", (name) => {
    const { root, cleanup } = makeRoot();
    try {
      expect(() => resolveArtifactPath(root, "scraper", name)).toThrow(ArtifactPathError);
    } finally {
      cleanup();
    }
  });

  it("accepts plain flat names and keeps them inside the root", () => {
    const { root, cleanup } = makeRoot();
    try {
      const resolved = resolveArtifactPath(root, "scraper", "run-standard.json");
      const prefix = path.resolve(root) + path.sep;
      expect(resolved.startsWith(prefix)).toBe(true);
      expect(resolved.endsWith(path.join("scraper", "run-standard.json"))).toBe(true);

      const demoResolved = resolveArtifactPath(root, "demo", "rerun-2026-08-21T00-00-00Z.json");
      expect(demoResolved.startsWith(prefix)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("resolves against an attacker-controlled root without escaping THAT root", () => {
    // Defense in depth: even a caller-supplied root confines resolution.
    const { root, cleanup } = makeRoot();
    try {
      expect(() => resolveArtifactPath(root, "demo", "../../outside.json")).toThrow(
        ArtifactPathError,
      );
    } finally {
      cleanup();
    }
  });
});

describe("artifact reading — bounded, parse-only, never executed", () => {
  it("reads and parses JSON from the scraper directory", () => {
    const { root, cleanup } = makeRoot();
    try {
      fs.writeFileSync(
        path.join(root, "scraper", "create.json"),
        JSON.stringify({ collector_id: "c_mt2yacvcyvyvim56d", status: "done" }),
      );
      const value = readArtifactJson("scraper", "create.json", root) as Record<string, unknown>;
      expect(value.status).toBe("done");
      expect(readArtifactText("scraper", "create.json", root)).toContain("c_mt2yacvcyvyvim56d");
    } finally {
      cleanup();
    }
  });

  it("throws ArtifactNotFoundError for missing or non-file targets", () => {
    const { root, cleanup } = makeRoot();
    try {
      expect(() => readArtifactJson("scraper", "missing.json", root)).toThrow(
        ArtifactNotFoundError,
      );
      fs.mkdirSync(path.join(root, "scraper", "not-a-file.json"));
      expect(() => readArtifactJson("scraper", "not-a-file.json", root)).toThrow(
        ArtifactNotFoundError,
      );
    } finally {
      cleanup();
    }
  });

  it("lists only regular files with safe names, sorted", () => {
    const { root, cleanup } = makeRoot();
    try {
      fs.writeFileSync(path.join(root, "scraper", "b.json"), "{}");
      fs.writeFileSync(path.join(root, "scraper", "a.json"), "{}");
      fs.mkdirSync(path.join(root, "scraper", "subdir"));
      const names = listArtifacts("scraper", root).map((stat) => stat.name);
      expect(names).toEqual(["a.json", "b.json"]);
    } finally {
      cleanup();
    }
  });

  it("returns stats including mtime for observedAt derivation", () => {
    const { root, cleanup } = makeRoot();
    try {
      fs.writeFileSync(path.join(root, "scraper", "run-standard.json"), "[{}]");
      const [stat] = listArtifacts("scraper", root);
      expect(stat?.bytes).toBe(4);
      expect(stat?.modifiedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    } finally {
      cleanup();
    }
  });
});

describe("default root", () => {
  it("anchors at <cwd>/artifacts", () => {
    expect(defaultArtifactsRoot()).toBe(path.resolve(process.cwd(), "artifacts"));
  });
});
