/** Deterministic public API 1.1 and cursor traversal evidence. */

export {};

type Json = Record<string, unknown>;
type RouteGet = (request: Request) => Promise<Response>;

function object(value: unknown): Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("public endpoint returned a non-object body");
  }
  return value as Json;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("public endpoint returned a non-array field");
  return value;
}

async function getJson(handler: RouteGet, path: string): Promise<Json> {
  const response = await handler(new Request(`http://pulserank.local${path}`));
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  const body = object(await response.json());
  if (body.schemaVersion !== "1.1") {
    throw new Error(`${path} did not return public schema 1.1`);
  }
  return body;
}

async function traverseProducts(
  handler: RouteGet,
  query: URLSearchParams,
): Promise<{ count: number; pages: number }> {
  const seen = new Set<string>();
  let cursor: string | null = null;
  let totalCount: number | null = null;
  let pages = 0;
  do {
    const parameters = new URLSearchParams(query);
    parameters.set("limit", "37");
    if (cursor) parameters.set("cursor", cursor);
    const body = await getJson(handler, `/api/public/products?${parameters}`);
    const count = Number(body.totalCount);
    if (!Number.isInteger(count) || count < 0) throw new Error("invalid product totalCount");
    if (totalCount !== null && totalCount !== count) throw new Error("product totalCount drifted");
    totalCount = count;
    for (const item of array(body.items)) {
      const product = object(item);
      const slug = String(product.slug ?? "");
      if (slug === "" || seen.has(slug)) throw new Error("duplicate or empty product slug");
      const serving = object(product.serving);
      if (!("normalizedMl" in serving) || !("categoryProvenance" in product)) {
        throw new Error("product DTO is missing an API 1.1 field");
      }
      seen.add(slug);
    }
    cursor = typeof body.nextCursor === "string" ? body.nextCursor : null;
    pages += 1;
    if (pages > 1_000) throw new Error("product cursor did not terminate");
  } while (cursor);
  if (seen.size !== totalCount) {
    throw new Error(`product traversal saw ${seen.size}, expected ${totalCount ?? 0}`);
  }
  return { count: seen.size, pages };
}

async function traverseLeaderboard(
  handler: RouteGet,
  board: string,
): Promise<{ count: number; pages: number }> {
  const seen = new Set<string>();
  let cursor: string | null = null;
  let totalCount: number | null = null;
  let pages = 0;
  do {
    const parameters = new URLSearchParams({ board, limit: "25" });
    if (cursor) parameters.set("cursor", cursor);
    const body = await getJson(handler, `/api/public/leaderboards?${parameters}`);
    const count = Number(body.totalCount);
    if (totalCount !== null && totalCount !== count) {
      throw new Error("leaderboard totalCount drifted");
    }
    totalCount = count;
    for (const item of array(body.entries)) {
      const entry = object(item);
      const productId = String(entry.productId ?? "");
      if (productId === "" || seen.has(productId)) {
        throw new Error("duplicate leaderboard product");
      }
      if (!("previousRank" in entry) || !("rankDelta" in entry)) {
        throw new Error("leaderboard entry is missing rank history fields");
      }
      seen.add(productId);
    }
    cursor = typeof body.nextCursor === "string" ? body.nextCursor : null;
    pages += 1;
    if (pages > 1_000) throw new Error("leaderboard cursor did not terminate");
  } while (cursor);
  if (seen.size !== totalCount) {
    throw new Error(`leaderboard traversal saw ${seen.size}, expected ${totalCount ?? 0}`);
  }
  return { count: seen.size, pages };
}

const productsRoute = await import("@/app/api/public/products/route");
const productRoute = await import("@/app/api/public/products/[slug]/route");
const categoriesRoute = await import("@/app/api/public/categories/route");
const leaderboardRoute = await import("@/app/api/public/leaderboards/route");
const changesRoute = await import("@/app/api/public/changes/route");
const liveDataRoute = await import("@/app/api/public/live-data/route");
const methodologyRoute = await import("@/app/api/public/source-methodology/route");
const searchRoute = await import("@/app/api/public/search/route");
const { sql } = await import("@/server/db/client");

try {
  const sorts: Record<string, { count: number; pages: number }> = {};
  for (const sort of ["name", "caffeine-desc", "caffeine-asc", "newest"]) {
    sorts[sort] = await traverseProducts(
      productsRoute.GET,
      new URLSearchParams({ sort }),
    );
  }

  const categories = await getJson(categoriesRoute.GET, "/api/public/categories");
  const categoryTraversals: Record<string, number> = {};
  for (const item of array(categories.categories)) {
    const category = String(object(item).category ?? "");
    const result = await traverseProducts(
      productsRoute.GET,
      new URLSearchParams({ category, sort: "name" }),
    );
    categoryTraversals[category] = result.count;
  }

  const facetTraversals: Record<string, number> = {};
  for (const query of [
    ["exactOnly", "true"],
    ["hasSugar", "true"],
    ["hasCalories", "true"],
    ["caffeineMaxMg", "100"],
  ] as const) {
    const result = await traverseProducts(
      productsRoute.GET,
      new URLSearchParams({ [query[0]]: query[1], sort: "name" }),
    );
    facetTraversals[`${query[0]}=${query[1]}`] = result.count;
  }

  const firstPage = await getJson(
    productsRoute.GET,
    "/api/public/products?sort=name&limit=1",
  );
  const firstProduct = object(array(firstPage.items)[0]);
  const slug = String(firstProduct.slug);
  const detailResponse = await productRoute.GET(
    new Request(`http://pulserank.local/api/public/products/${slug}`),
    { params: Promise.resolve({ slug }) },
  );
  if (!detailResponse.ok) throw new Error("product detail endpoint failed");
  const detail = object(await detailResponse.json());
  if (detail.schemaVersion !== "1.1") throw new Error("product detail schema mismatch");

  const search = await getJson(
    searchRoute.GET,
    "/api/public/search?q=coffee&limit=17",
  );
  if (!Number.isInteger(Number(search.totalCount))) throw new Error("search total missing");

  const leaderboards: Record<string, { count: number; pages: number }> = {};
  for (const board of [
    "highest-total-caffeine",
    "highest-exact-concentration",
    "caffeine-free",
  ]) {
    leaderboards[board] = await traverseLeaderboard(leaderboardRoute.GET, board);
  }

  const changes = await getJson(changesRoute.GET, "/api/public/changes?limit=20");
  for (const item of array(changes.items)) {
    const event = object(item);
    if (!("field" in event) || !("before" in event) || !("after" in event)) {
      throw new Error("changes endpoint omitted field points");
    }
    if (/rawText|source prose|payload/i.test(JSON.stringify(event))) {
      throw new Error("changes endpoint exposed a private field");
    }
  }

  const liveData = await getJson(liveDataRoute.GET, "/api/public/live-data");
  const liveJson = JSON.stringify(liveData);
  if (/j_[A-Za-z0-9]+/.test(liveJson) || liveJson.includes("rawPayload")) {
    throw new Error("live data exposed provider identity or raw payloads");
  }
  const methodology = await getJson(
    methodologyRoute.GET,
    "/api/public/source-methodology",
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "1.1",
        productTraversals: sorts,
        categoryTraversals,
        facetTraversals,
        productDetail: { slug, fields: ["serving.normalizedMl", "categoryProvenance"] },
        searchCount: Number(search.totalCount),
        leaderboards,
        changesReturned: array(changes.items).length,
        liveData: {
          trustedProductCount: Number(liveData.trustedProductCount),
          recentRunCount: array(liveData.recentRuns).length,
          providerIdentityRedacted: true,
        },
        methodologySchema: methodology.schemaVersion,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
