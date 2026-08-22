# Product image edge matting

PulseRank uses a deterministic server-side image transform to remove light rectangular canvases from approved product photographs. The transform makes package images sit naturally on the dark Explore surface without using CSS blend modes, geometric masks, or a general-purpose background-removal model.

The technique is intentionally narrow: it removes only light, neutral pixels that are connected to an image edge. White labels, lettering, and package details enclosed by the product remain opaque because they are not connected to the outer canvas.

## Processing pipeline

```text
Trusted product slug
        |
        v
Current trusted product + approved image URL
        |
        v
Exact-host and HTTPS authorization
        |
        v
Fetch + redirect/media/size validation
        |
        v
Sharp decode, rotate, resize, RGBA conversion
        |
        v
Border-connected light-pixel flood fill
        |
        v
Feathered alpha matte
        |
        v
Transparent trim + 8 px breathing room
        |
        v
Cached WebP response or procedural UI fallback
```

The renderer does not mutate the raw record, trusted observation, or media-publication authorization. It creates a presentation derivative at request time.

## Publication boundary

The renderer accepts an image only when all of these conditions hold:

- The requested slug resolves to a current trusted product.
- The product DTO exposes a publication-approved image URL.
- The URL uses HTTPS and the exact host `www.caffeineinformer.com`.
- Every redirect destination passes the same host and protocol check before it is followed.
- The response media type is AVIF, GIF, JPEG, PNG, or WebP.
- The declared and downloaded source stay within the 5 MiB input limit.
- Sharp can decode the image within the 16-million-pixel input limit.

The local endpoint is:

```text
GET /api/public/product-images/:slug
```

Callers supply only a product slug. The endpoint never reflects the upstream URL, credentials, raw record, or transform error to the browser. A missing, blocked, unavailable, or untransformable image returns `404` with `Cache-Control: no-store`, allowing the UI to use its procedural specimen.

## Edge-matte algorithm

### 1. Normalize the source

Sharp applies orientation metadata, scales the image inside a `640 x 640` box without enlargement, and converts it to raw RGBA pixels. The matte function rejects any buffer whose channel count or dimensions do not match the expected RGBA layout.

### 2. Identify candidate canvas pixels

A pixel is a removable candidate when it is both light and close to neutral:

```text
minimum(red, green, blue) >= 210
maximum(red, green, blue) - minimum(red, green, blue) <= 38
```

The channel-spread constraint prevents bright saturated package colors from being mistaken for a white or gray canvas.

### 3. Flood-fill from the border

The algorithm seeds a queue with qualifying pixels on all four image edges. It then performs a four-neighbor flood fill through qualifying pixels:

```text
          up
           |
left -- current -- right
           |
         down
```

Only candidate pixels reachable from the outer border enter the matte. A white logo surrounded by dark packaging is disconnected from the border and remains untouched.

### 4. Feather the alpha value

Connected pixels are not switched to transparent with a hard binary threshold. PulseRank calculates a removal strength from lightness and neutrality:

```text
lightness = clamp((minimum channel - 210) / (245 - 210), 0, 1)
neutrality = clamp(1 - channel spread / 38, 0, 1)
smooth lightness = lightness^2 * (3 - 2 * lightness)
removal strength = smooth lightness * neutrality
new alpha = original alpha * (1 - removal strength)
```

The smooth-step curve softens near-white antialiased edges while leaving darker or more chromatic pixels increasingly opaque. Pixels at or above the fully-transparent light threshold of `245` become fully transparent only when they are neutral and border-connected.

### 5. Trim and encode

When the matte changes at least one pixel, Sharp trims the transparent exterior with threshold `4`, then adds `8 px` of transparent padding on every side. The padding prevents packaging from touching its UI frame.

The final derivative is WebP with:

| Option | Value |
| --- | ---: |
| Color quality | `88` |
| Alpha quality | `92` |
| Encoding effort | `4` |

Dark or otherwise non-matching canvases remain opaque and are encoded without the transparent trim step.

## Caching and delivery

The server stores up to 128 in-flight or completed render promises in a process-local map keyed by the authorized source URL. Sharing the promise deduplicates concurrent requests for the same product. A failed render is removed from the map so a later request can retry.

Successful endpoint responses include:

```text
Content-Type: image/webp
Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800
X-Content-Type-Options: nosniff
ETag: <SHA-256 of rendered bytes>
```

Matching `If-None-Match` requests receive `304 Not Modified`.

The readiness path warms the default 24-row Explore query, category data, and the default inspector image. It waits no longer than 3.5 seconds for that warmup and does not fail deployment readiness when image processing fails. Product text and procedural artwork remain available without the image.

## Browser integration

Explore requests the local endpoint instead of rendering the source URL directly. The inspector image loads immediately. Compact catalog images use an `IntersectionObserver` with a `160 px` vertical margin, so image transforms begin shortly before a result enters the viewport.

If the DTO has no approved image or the local image request fails, the component replaces the photograph with deterministic HTML/CSS artwork derived from the product slug and category. This keeps layout dimensions stable and avoids broken-image icons.

## Why this approach

### Advantages

- Deterministic output makes the transform testable and repeatable.
- Border connectivity preserves enclosed white labels that a global chroma-key would erase.
- Server-side rendering keeps authorization, upstream URLs, and transform details out of the client.
- Transparent WebP works with the existing dark specimen stage without CSS blending artifacts.
- The method needs no product-specific masks or external image-processing service.

### Limitations

- It is not general subject segmentation. Colored, dark, textured, or disconnected backgrounds remain.
- A light package region touching the image edge may be treated as background.
- Heavy source shadows or compression halos may remain partly visible.
- Thresholds are source-specific and should not be changed without representative fixtures.
- The 128-entry render cache is process-local and resets when the server restarts.

These limits are deliberate. When the algorithm cannot confidently identify the outer canvas, preserving source pixels is safer than erasing product details.

## Verification

Run the deterministic matte and authorization tests:

```bash
bun test tests/unit/server/products/product-image.test.ts \
  tests/unit/server/products/image-policy.test.ts
```

Then verify the endpoint and production build:

```bash
curl --fail --output /tmp/pulserank-product.webp \
  http://localhost:3000/api/public/product-images/10-hour-energy-shot

bun run typecheck
bun run build
```

The unit suite covers:

- Removal of edge-connected white canvas pixels.
- Preservation of a disconnected white package detail.
- Preservation of a dark source canvas.
- Emission of a transparent WebP.
- Rejection of non-HTTPS and unapproved image hosts.
- Rejection of an off-boundary redirect before its destination is requested.
- Acceptance of bounded redirects that remain on the approved source host.
- Revalidation of previously classified media blocks.

The Explore end-to-end test also checks that cards use the local renderer and that the response is a cacheable WebP. The client component owns the procedural fallback and never receives the upstream image URL from this endpoint.

## Implementation map

| Responsibility | File |
| --- | --- |
| Image publication authorization | `src/server/products/image-policy.ts` |
| Flood fill, alpha derivation, encoding, and process cache | `src/server/products/product-image.ts` |
| Slug-addressed public endpoint and HTTP caching | `src/app/api/public/product-images/[slug]/route.ts` |
| Readiness warmup | `src/server/products/product-image-warmup.ts` |
| Explore image loading and procedural fallback | `src/components/pulserank/explore/explore-workspace.tsx` |
| Matte behavior tests | `tests/unit/server/products/product-image.test.ts` |
| Authorization tests | `tests/unit/server/products/image-policy.test.ts` |
| Browser integration tests | `tests/e2e/pulserank-explore.spec.ts` |

## Related documentation

- [Caffeine Informer publication policy](publication-policy.md)
- [Caffeine Informer source register](source-register.md)
