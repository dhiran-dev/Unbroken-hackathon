import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "README.md",
  ".env.example",
  "deploy/coolify.md",
  "docs/architecture/healing-safety.md",
  "docs/architecture/public-accessibility.md",
  "docs/architecture/trusted-collection.md",
  "docs/runbooks/deployment.md",
  "docs/runbooks/healing.md",
  "docs/runbooks/incident-response.md",
  "artifacts/examples/README.md",
];

const productionCollectorId = "c_msyjsllt1r9ej5tdub";
const publicSourceUrl =
  "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod";
const problems: string[] = [];

function listFiles(args: string[]) {
  const result = Bun.spawnSync(["git", "ls-files", ...args, "-z"]);
  if (result.exitCode !== 0) {
    problems.push(`git ls-files ${args.join(" ")} failed.`);
    return [];
  }
  return new TextDecoder()
    .decode(result.stdout)
    .split("\0")
    .filter(Boolean);
}

async function text(file: string) {
  return readFile(path.join(root, file), "utf8");
}

for (const file of requiredFiles) {
  try {
    if (!(await Bun.file(path.join(root, file)).exists())) {
      problems.push(`Required release file is missing: ${file}`);
    }
  } catch {
    problems.push(`Required release file could not be read: ${file}`);
  }
}

const trackedFiles = listFiles([]);
const workspaceFiles = listFiles(["--cached", "--others", "--exclude-standard"]);

const trackedEnvFiles = trackedFiles.filter(
  (file) => file.startsWith(".env") && file !== ".env.example",
);
if (trackedEnvFiles.length > 0) {
  problems.push(`Secret-bearing environment file is tracked: ${trackedEnvFiles.join(", ")}`);
}

const trackedIncidentFiles = trackedFiles.filter((file) =>
  file.startsWith("artifacts/incidents/"),
);
if (trackedIncidentFiles.length > 0) {
  problems.push(
    `Private incident artifact is tracked: ${trackedIncidentFiles.join(", ")}`,
  );
}

const envExample = await text(".env.example");
for (const line of envExample.split("\n")) {
  const match = /^(DATABASE_URL|BETTER_AUTH_SECRET|BRIGHTDATA_API_TOKEN|FIREWORKS_API_KEY|OWNER_PASSWORD|JUDGE_ADMIN_PASSWORD)\s*=(.*)$/.exec(line);
  if (match?.[2]?.trim()) {
    problems.push(`${match[1]} must be blank in .env.example.`);
  }
}
if (!envExample.includes(`BRIGHTDATA_COLLECTOR_ID=${productionCollectorId}`)) {
  problems.push(".env.example does not pin the production collector ID.");
}
if (!envExample.includes(`SFMTA_SOURCE_URL=${publicSourceUrl}`)) {
  problems.push(".env.example does not pin the public SFMTA source URL.");
}

const implementationFiles = workspaceFiles.filter(
  (file) =>
    file.startsWith("src/") ||
    file.startsWith("scripts/") ||
    file === "Dockerfile" ||
    file.startsWith(".github/workflows/"),
);
const automaticApprovalFlag = ["--auto", "approve"].join("-");
for (const file of implementationFiles) {
  let body: string;
  try {
    body = await text(file);
  } catch {
    continue;
  }
  if (body.includes(automaticApprovalFlag)) {
    problems.push(`Automatic approval flag found in implementation: ${file}`);
  }
}

const exampleFiles = workspaceFiles.filter(
  (file) => file.startsWith("artifacts/examples/") && file.endsWith(".json"),
);
if (exampleFiles.length === 0) {
  problems.push("No sanitized synthetic JSON examples were found.");
}
for (const file of exampleFiles) {
  try {
    const value = JSON.parse(await text(file)) as {
      example?: unknown;
      sanitized?: unknown;
    };
    if (value.example !== true || value.sanitized !== true) {
      problems.push(`Synthetic example must declare example/sanitized: ${file}`);
    }
  } catch {
    problems.push(`Synthetic example is not valid JSON: ${file}`);
  }
}

if (problems.length > 0) {
  console.error("Release check failed:");
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `Release check passed: ${requiredFiles.length} docs, ${exampleFiles.length} synthetic examples, no tracked environment files or private artifacts.`,
  );
}
