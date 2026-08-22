CREATE TABLE "pulse"."product_media_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"product_observation_id" uuid NOT NULL,
	"raw_record_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"publication_state" text DEFAULT 'allowed' NOT NULL,
	"policy_version" text NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_media_publications_state_ck" CHECK ("pulse"."product_media_publications"."publication_state" IN ('allowed', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "pulse"."product_media_publications" ADD CONSTRAINT "product_media_publications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pulse"."products"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pulse"."product_media_publications" ADD CONSTRAINT "product_media_publications_product_observation_id_product_observations_id_fk" FOREIGN KEY ("product_observation_id") REFERENCES "pulse"."product_observations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pulse"."product_media_publications" ADD CONSTRAINT "product_media_publications_raw_record_id_raw_records_id_fk" FOREIGN KEY ("raw_record_id") REFERENCES "pulse"."raw_records"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_publications_observation_uidx" ON "pulse"."product_media_publications" USING btree ("product_observation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_media_publications_raw_record_uidx" ON "pulse"."product_media_publications" USING btree ("raw_record_id");
--> statement-breakpoint
CREATE INDEX "product_media_publications_product_idx" ON "pulse"."product_media_publications" USING btree ("product_id");
--> statement-breakpoint
WITH linked_media AS (
  SELECT DISTINCT ON (observation.id)
    product.id AS product_id,
    observation.id AS product_observation_id,
    raw.id AS raw_record_id,
    raw.payload ->> 'image_url' AS image_url
  FROM pulse.products AS product
  JOIN pulse.product_observations AS observation
    ON observation.id = product.current_trusted_observation_id
   AND observation.product_id = product.id
   AND observation.status = 'trusted'
  JOIN pulse.raw_records AS raw
    ON raw.captured_at = observation.observed_at
   AND lower(
      regexp_replace(
        regexp_replace(
          split_part(
            coalesce(
              raw.payload ->> 'product_page_url',
              raw.payload ->> 'product_url',
              raw.payload -> 'input' ->> 'url'
            ),
            '?',
            1
          ),
          '/+$',
          ''
        ),
        '^.*/',
        ''
      )
    ) = observation.slug
  WHERE raw.payload ->> 'image_url' ~* '^https://www\.caffeineinformer\.com/'
  ORDER BY observation.id, raw.created_at DESC, raw.id DESC
)
INSERT INTO pulse.product_media_publications (
  product_id,
  product_observation_id,
  raw_record_id,
  image_url,
  publication_state,
  policy_version
)
SELECT
  product_id,
  product_observation_id,
  raw_record_id,
  image_url,
  'allowed',
  'caffeine-informer-product-image-v1'
FROM linked_media
ON CONFLICT (product_observation_id) DO NOTHING;
