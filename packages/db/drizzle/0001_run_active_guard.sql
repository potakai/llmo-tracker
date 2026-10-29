-- 止まったまま残っている run があると一意インデックスが作れないので、
-- ブランドごとに一番新しいもの以外を failed にしてからインデックスを作る
UPDATE "run" SET "status" = 'failed', "finished_at" = now()
WHERE "status" IN ('queued', 'running')
  AND "id" NOT IN (
    SELECT DISTINCT ON ("brand_id") "id" FROM "run"
    WHERE "status" IN ('queued', 'running')
    ORDER BY "brand_id", "created_at" DESC
  );--> statement-breakpoint
CREATE UNIQUE INDEX "run_one_active_per_brand_uq" ON "run" USING btree ("brand_id") WHERE "run"."status" in ('queued', 'running');
