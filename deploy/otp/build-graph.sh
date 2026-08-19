#!/usr/bin/env bash
set -euo pipefail

readonly OTP_IMAGE="docker.io/opentripplanner/opentripplanner@sha256:a7eac7da397faa9ec9dee407d4204895d24df4981500662fa6793aae0e71fd8f"
readonly AMD64_MANIFEST="sha256:f5e8e6cf771d0e7c742ce54e79770f0dc8b921f3382d7ad9507e4d13447e97de"
readonly ARM64_MANIFEST="sha256:b43dee5a664d5b130eb72d69c9cef7876251bec1b0a9168056ccf12e9646daf9"
readonly OSM_URL="https://download.geofabrik.de/north-america/us/california/norcal-260818.osm.pbf"
readonly OSM_BYTES="649346007"
readonly OSM_MD5="c768ad7dc1b4f2d15ff551f9c8016641"
readonly OSM_SOURCE_SHA256="f25984fd70d3516b2753bae457fbf25dbe985817d198c746d87b4a1557ec186d"
readonly OSM_EXTRACT_BYTES="19894206"
readonly OSM_EXTRACT_SHA256="c7b3a04f1bd447be696ccd8bad0c94aa63a92e54ec499c3e260536448458e910"
readonly OSM_BBOX="-122.58,37.68,-122.31,37.86"

CANDIDATE_CONTAINER=""
CANDIDATE_NETWORK=""
NEXT_LINK=""
cleanup() {
  if [[ -n "$CANDIDATE_CONTAINER" ]]; then docker rm -f "$CANDIDATE_CONTAINER" >/dev/null 2>&1 || true; fi
  if [[ -n "$CANDIDATE_NETWORK" ]]; then docker network rm "$CANDIDATE_NETWORK" >/dev/null 2>&1 || true; fi
  if [[ -n "$NEXT_LINK" ]]; then rm -f -- "$NEXT_LINK"; fi
}
trap cleanup EXIT INT TERM
fail() { printf "%s\n" "OTP graph build failed; the current graph was kept." >&2; exit 1; }
required_value() { local name="$1"; [[ -n "${!name:-}" ]] || fail; }
for command_name in bun curl docker flock md5sum osmium sha256sum stat zip; do command -v "$command_name" >/dev/null 2>&1 || fail; done
required_value OTP_STATE_DIR
required_value OTP_SERVICE_DATETIME
[[ "$OTP_STATE_DIR" = /* && "$OTP_STATE_DIR" != "/" ]] || fail
readonly SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
readonly SOURCES_DIR="$OTP_STATE_DIR/sources"
readonly CANDIDATES_DIR="$OTP_STATE_DIR/candidates"
mkdir -p -- "$SOURCES_DIR" "$CANDIDATES_DIR"
exec 9>"$OTP_STATE_DIR/.build.lock"
flock -n 9 || fail
readonly CURRENT_BEFORE="$(readlink "$OTP_STATE_DIR/current" 2>/dev/null || true)"
readonly SOURCE_PBF="$SOURCES_DIR/norcal-260818.osm.pbf"
if [[ ! -f "$SOURCE_PBF" ]]; then
  readonly SOURCE_PART="$SOURCES_DIR/norcal-260818.osm.pbf.partial"
  curl --fail --location --silent --show-error --proto "=https" --tlsv1.2 "$OSM_URL" --output "$SOURCE_PART" || fail
  [[ "$(stat -c "%s" "$SOURCE_PART")" = "$OSM_BYTES" ]] || fail
  [[ "$(md5sum "$SOURCE_PART" | awk "{print \$1}")" = "$OSM_MD5" ]] || fail
  [[ "$(sha256sum "$SOURCE_PART" | awk "{print \$1}")" = "$OSM_SOURCE_SHA256" ]] || fail
  mv -- "$SOURCE_PART" "$SOURCE_PBF"
fi
[[ "$(stat -c "%s" "$SOURCE_PBF")" = "$OSM_BYTES" ]] || fail
[[ "$(md5sum "$SOURCE_PBF" | awk "{print \$1}")" = "$OSM_MD5" ]] || fail
[[ "$(sha256sum "$SOURCE_PBF" | awk "{print \$1}")" = "$OSM_SOURCE_SHA256" ]] || fail
osmium --version | grep -F "osmium version 1.16.0" >/dev/null || fail
osmium --version | grep -F "libosmium version 2.20.0" >/dev/null || fail
readonly CANDIDATE_DIR="$(mktemp -d "$CANDIDATES_DIR/candidate.XXXXXXXX")"
readonly EXTRACT_PBF="$CANDIDATE_DIR/sf.osm.pbf"
readonly STAGED_GTFS="$CANDIDATE_DIR/sf-active-gtfs.zip"
readonly GTFS_PROVENANCE="$CANDIDATE_DIR/gtfs-provenance.json"
osmium extract --bbox "$OSM_BBOX" --strategy complete_ways --set-bounds --output "$EXTRACT_PBF" "$SOURCE_PBF" || fail
osmium check-refs "$EXTRACT_PBF" >/dev/null || fail
[[ "$(stat -c "%s" "$EXTRACT_PBF")" = "$OSM_EXTRACT_BYTES" ]] || fail
[[ "$(sha256sum "$EXTRACT_PBF" | awk "{print \$1}")" = "$OSM_EXTRACT_SHA256" ]] || fail
bun run "$SCRIPT_DIR/gtfs-export-cli.ts" "$STAGED_GTFS" "$GTFS_PROVENANCE" || fail
readonly ACTIVE_GTFS_SHA="$(bun -e "const p=JSON.parse(await Bun.file(process.argv[1]).text());process.stdout.write(p.activeArchiveSha256)" "$GTFS_PROVENANCE")"
readonly GTFS_SHA="$(bun -e "const p=JSON.parse(await Bun.file(process.argv[1]).text());process.stdout.write(p.generatedArchiveSha256)" "$GTFS_PROVENANCE")"
[[ "$ACTIVE_GTFS_SHA" =~ ^[a-f0-9]{64}$ ]] || fail
[[ "$GTFS_SHA" =~ ^[a-f0-9]{64}$ ]] || fail
[[ "$(sha256sum "$STAGED_GTFS" | awk "{print \$1}")" = "$GTFS_SHA" ]] || fail
cp -- "$SCRIPT_DIR/otp-config.json" "$CANDIDATE_DIR/otp-config.json"
docker run --rm --memory 8g --env JAVA_TOOL_OPTIONS="-Xms1g -Xmx7g -XX:+ExitOnOutOfMemoryError" --volume "$CANDIDATE_DIR:/var/opentripplanner" "$OTP_IMAGE" --build --save || fail
readonly GRAPH="$CANDIDATE_DIR/graph.obj"
[[ -s "$GRAPH" ]] || fail
readonly GRAPH_BYTES="$(stat -c "%s" "$GRAPH")"
readonly GRAPH_SHA256="$(sha256sum "$GRAPH" | awk "{print \$1}")"
[[ "$GRAPH_SHA256" =~ ^[a-f0-9]{64}$ ]] || fail
OTP_MANIFEST_OUTPUT="$CANDIDATE_DIR/manifest.json" OTP_GTFS_FILENAME="sf-active-gtfs.zip" OTP_GTFS_ACTIVE_ARCHIVE_SHA256="$ACTIVE_GTFS_SHA" OTP_GTFS_ZIP_SHA256="$GTFS_SHA" OTP_GRAPH_BYTES="$GRAPH_BYTES" OTP_GRAPH_SHA256="$GRAPH_SHA256" bun run "$SCRIPT_DIR/manifest-writer.ts" || fail
readonly CANDIDATE_NAME="${CANDIDATE_DIR##*/}"
CANDIDATE_NETWORK="unbroken-otp-verify-$CANDIDATE_NAME"
CANDIDATE_CONTAINER="unbroken-otp-verify-$CANDIDATE_NAME"
docker network create --internal "$CANDIDATE_NETWORK" >/dev/null || fail
docker run -d --name "$CANDIDATE_CONTAINER" --network "$CANDIDATE_NETWORK" --memory 4g --read-only --security-opt no-new-privileges --cap-drop ALL --tmpfs /tmp:rw,noexec,nosuid,size=268435456 --env JAVA_TOOL_OPTIONS="-Xms512m -Xmx3g -XX:+ExitOnOutOfMemoryError" --volume "$CANDIDATE_DIR:/var/opentripplanner:ro" "$OTP_IMAGE" --load --serve >/dev/null || fail
[[ "$(docker inspect --format "{{.Config.Image}}" "$CANDIDATE_CONTAINER")" = "$OTP_IMAGE" ]] || fail
[[ "$(docker inspect --format "{{.HostConfig.ReadonlyRootfs}}" "$CANDIDATE_CONTAINER")" = "true" ]] || fail
[[ "$(docker inspect --format "{{.HostConfig.Memory}}" "$CANDIDATE_CONTAINER")" = "4294967296" ]] || fail
[[ "$(docker inspect --format "{{json .HostConfig.SecurityOpt}}" "$CANDIDATE_CONTAINER")" = '["no-new-privileges"]' ]] || fail
[[ "$(docker inspect --format "{{json .HostConfig.CapDrop}}" "$CANDIDATE_CONTAINER")" = '["ALL"]' ]] || fail
[[ "$(docker inspect --format "{{index .HostConfig.Tmpfs \"/tmp\"}}" "$CANDIDATE_CONTAINER")" = "rw,noexec,nosuid,size=268435456" ]] || fail
[[ "$(docker inspect --format "{{len .HostConfig.PortBindings}}" "$CANDIDATE_CONTAINER")" = "0" ]] || fail
[[ "$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"/var/opentripplanner\"}}{{.Source}}|{{.RW}}{{end}}{{end}}" "$CANDIDATE_CONTAINER")" = "$CANDIDATE_DIR|false" ]] || fail
readonly PRIVATE_IP="$(docker inspect --format "{{with index .NetworkSettings.Networks \"$CANDIDATE_NETWORK\"}}{{.IPAddress}}{{end}}" "$CANDIDATE_CONTAINER")"
[[ -n "$PRIVATE_IP" ]] || fail
readonly ARCHITECTURE="$(docker image inspect --format "{{.Architecture}}" "$OTP_IMAGE")"
case "$ARCHITECTURE" in amd64) readonly PLATFORM_MANIFEST="$AMD64_MANIFEST" ;; arm64) readonly PLATFORM_MANIFEST="$ARM64_MANIFEST" ;; *) fail ;; esac
[[ "$(docker network inspect --format "{{.Internal}}" "$CANDIDATE_NETWORK")" = "true" ]] || fail
CANDIDATE_READY="false"
for _attempt in {1..30}; do
  if OTP_BASE_URL="http://$PRIVATE_IP:8080" OTP_GRAPH_MANIFEST_PATH="$CANDIDATE_DIR/manifest.json" OTP_PLATFORM_MANIFEST="$PLATFORM_MANIFEST" OTP_SERVICE_DATETIME="$OTP_SERVICE_DATETIME" bun run "$SCRIPT_DIR/verify-cli.ts" >/dev/null 2>/dev/null; then CANDIDATE_READY="true"; break; fi
  sleep 3
done
[[ "$CANDIDATE_READY" = "true" ]] || fail
docker rm -f "$CANDIDATE_CONTAINER" >/dev/null || fail
CANDIDATE_CONTAINER=""
docker network rm "$CANDIDATE_NETWORK" >/dev/null || fail
CANDIDATE_NETWORK=""
bun run "$SCRIPT_DIR/gtfs-export-cli.ts" --verify "$GTFS_PROVENANCE" || fail
[[ "$(readlink "$OTP_STATE_DIR/current" 2>/dev/null || true)" = "$CURRENT_BEFORE" ]] || fail
NEXT_LINK="$OTP_STATE_DIR/.current.$CANDIDATE_NAME"
ln -s "candidates/$CANDIDATE_NAME" "$NEXT_LINK" || fail
mv -Tf -- "$NEXT_LINK" "$OTP_STATE_DIR/current" || fail
NEXT_LINK=""
printf "%s\n" "OTP graph candidate verified and promoted."
