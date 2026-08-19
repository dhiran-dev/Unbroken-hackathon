import {
  chmodSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
const BUILD = new URL("../../deploy/otp/build-graph.sh", import.meta.url)
  .pathname;
const BUILD_TEXT = readFileSync(BUILD, "utf8");
const BUN = execFileSync("bash", ["-lc", "command -v bun"], {
  encoding: "utf8",
}).trim();
const IMAGE =
  "docker.io/opentripplanner/opentripplanner@sha256:a7eac7da397faa9ec9dee407d4204895d24df4981500662fa6793aae0e71fd8f";
function command(directory: string, name: string, body: string) {
  const path = join(directory, name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`);
  chmodSync(path, 0o700);
}
function harness(mode: "success" | "probe-failure" | "stale") {
  const root = mkdtempSync(join(tmpdir(), "otp-operator-"));
  const bin = join(root, "bin");
  const state = join(root, "state");
  mkdirSync(bin);
  mkdirSync(join(state, "sources"), { recursive: true });
  mkdirSync(join(state, "candidates", "prior"), { recursive: true });
  writeFileSync(join(state, "sources", "norcal-260818.osm.pbf"), "");
  symlinkSync("candidates/prior", join(state, "current"));
  command(
    bin,
    "stat",
    `case "\$*" in *norcal-260818*) echo 649346007;; *sf.osm.pbf*) echo 19894206;; *graph.obj*) echo 100;; *) /usr/bin/stat "\$@";; esac`,
  );
  command(bin, "md5sum", `echo "c768ad7dc1b4f2d15ff551f9c8016641  \$1"`);
  command(
    bin,
    "sha256sum",
    `case "\$1" in *norcal-260818*) h=f25984fd70d3516b2753bae457fbf25dbe985817d198c746d87b4a1557ec186d;; *sf.osm.pbf*) h=c7b3a04f1bd447be696ccd8bad0c94aa63a92e54ec499c3e260536448458e910;; *sf-active-gtfs.zip*) h=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa;; *graph.obj*) h=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb;; esac; echo "\$h  \$1"`,
  );
  command(
    bin,
    "osmium",
    `if [[ "\${1:-}" = --version ]]; then printf "osmium version 1.16.0\nlibosmium version 2.20.0\n"; elif [[ "\${1:-}" = extract ]]; then while [[ \${1:-} ]]; do if [[ "\$1" = --output ]]; then shift; : >"\$1"; break; fi; shift; done; fi`,
  );
  command(
    bin,
    "bun",
    `if [[ "\$*" = *gtfs-export-cli.ts* ]]; then if [[ "\${3:-}" = --verify ]]; then exit 0; fi; printf x >"\$3"; printf '{"snapshotId":"active","activeArchiveSha256":"e3fa3823286462e892aba89f3764e3e5bde8d9aaf9760b89261faf434c27192c","coverageFingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","counts":{"stops":3238,"routes":1,"trips":1,"stopTimes":1,"services":1,"shapePoints":45308},"generatedArchiveBytes":1,"generatedArchiveSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' >"\$4"; elif [[ "\$*" = *manifest-writer.ts* ]]; then printf '{}' >"\$OTP_MANIFEST_OUTPUT"; elif [[ "\$*" = *verify-cli.ts* ]]; then [[ "\$OTP_BASE_URL" = "http://172.20.0.2:8080" ]] || exit 2; [[ "\$OTP_GRAPH_MANIFEST_PATH" == "\$OTP_STATE_DIR"/candidates/candidate.*/manifest.json ]] || exit 2; [[ "\$OTP_PLATFORM_MANIFEST" = "sha256:f5e8e6cf771d0e7c742ce54e79770f0dc8b921f3382d7ad9507e4d13447e97de" ]] || exit 2; [[ "\$OTP_SERVICE_DATETIME" = "2026-08-21T08:30:00-07:00" ]] || exit 2; if [[ "${mode}" = probe-failure ]]; then exit 1; fi; if [[ "${mode}" = stale ]]; then ln -sfn candidates/concurrent "\$OTP_STATE_DIR/current"; fi; else ${BUN} "\$@"; fi`,
  );
  command(
    bin,
    "docker",
    `if [[ "\${1:-}" = run ]]; then for arg in "\$@"; do case "\$arg" in *:/var/opentripplanner*) d=\${arg%%:*}; printf "%s" "\$d" >"${root}/mount";; esac; done; if [[ " \$* " = *" --build "* ]]; then printf x >"\$d/graph.obj"; else echo container; fi; elif [[ "\${1:-}" = inspect ]]; then f="\$3"; case "\$f" in *Config.Image*) echo "${IMAGE}";; *ReadonlyRootfs*) echo true;; *HostConfig.Memory*) echo 4294967296;; *SecurityOpt*) echo '["no-new-privileges"]';; *CapDrop*) echo '["ALL"]';; *HostConfig.Tmpfs*) echo 'rw,noexec,nosuid,size=268435456';; *PortBindings*) echo 0;; *Mounts*) printf "%s|false\n" "\$(cat "${root}/mount")";; *NetworkSettings*) echo 172.20.0.2;; esac; elif [[ "\${1:-}" = image ]]; then echo amd64; elif [[ "\${1:-}" = network && "\${2:-}" = inspect ]]; then echo true; fi`,
  );
  for (const name of ["curl", "flock", "sleep", "zip"]) command(bin, name, ":");
  const env = {
    ...process.env,
    PATH: bin + ":" + process.env.PATH,
    OTP_STATE_DIR: state,
    OTP_SERVICE_DATETIME: "2026-08-21T08:30:00-07:00",
  };
  let ok = true;
  try {
    execFileSync("bash", [BUILD], { env, stdio: "pipe" });
  } catch {
    ok = false;
  }
  return { ok, state };
}
describe("OTP operator build seam", () => {
  it("requires final-service security hardening on the ephemeral candidate", () => {
    expect(BUILD_TEXT).toContain("--security-opt no-new-privileges");
    expect(BUILD_TEXT).toContain("--cap-drop ALL");
    expect(BUILD_TEXT).toContain(
      "--tmpfs /tmp:rw,noexec,nosuid,size=268435456",
    );
    expect(BUILD_TEXT).toContain("{{json .HostConfig.SecurityOpt}}");
    expect(BUILD_TEXT).toContain("{{json .HostConfig.CapDrop}}");
    expect(BUILD_TEXT).toContain("{{index .HostConfig.Tmpfs");
  });
  it("retains current on failed live probe and promotes only after success", () => {
    const failed = harness("probe-failure");
    expect(failed.ok).toBe(false);
    expect(readlinkSync(join(failed.state, "current"))).toBe(
      "candidates/prior",
    );
    const passed = harness("success");
    expect(passed.ok).toBe(true);
    expect(readlinkSync(join(passed.state, "current"))).toMatch(
      /^candidates\/candidate\./,
    );
  });
  it("refuses promotion when current changes after candidate verification", () => {
    const stale = harness("stale");
    expect(stale.ok).toBe(false);
    expect(readlinkSync(join(stale.state, "current"))).toBe(
      "candidates/concurrent",
    );
  });
});
