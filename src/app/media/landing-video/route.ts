import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const VIDEO_PATH = path.join(
  process.cwd(),
  "public",
  "landing",
  "assets",
  "pulserank_upscaled_ai.mp4",
);

const CACHE_CONTROL = "public, max-age=14400, s-maxage=14400";

function videoHeaders(size: number): Headers {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE_CONTROL,
    "Content-Length": String(size),
    "Content-Type": "video/mp4",
  });
}

export async function HEAD() {
  const file = await stat(VIDEO_PATH);
  return new Response(null, { headers: videoHeaders(file.size) });
}

export async function GET(request: Request) {
  const file = await stat(VIDEO_PATH);
  const range = request.headers.get("range");

  if (!range) {
    const stream = createReadStream(VIDEO_PATH);
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
      headers: videoHeaders(file.size),
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    return new Response(null, {
      headers: { "Content-Range": `bytes */${file.size}` },
      status: 416,
    });
  }

  let start: number;
  let end: number;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return new Response(null, {
        headers: { "Content-Range": `bytes */${file.size}` },
        status: 416,
      });
    }
    start = Math.max(0, file.size - suffixLength);
    end = file.size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
  }

  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || start >= file.size
    || end < start
  ) {
    return new Response(null, {
      headers: { "Content-Range": `bytes */${file.size}` },
      status: 416,
    });
  }

  const contentLength = end - start + 1;
  const headers = videoHeaders(contentLength);
  headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);

  const stream = createReadStream(VIDEO_PATH, { end, start });
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, {
    headers,
    status: 206,
  });
}
