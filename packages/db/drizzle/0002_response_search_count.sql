ALTER TABLE "response" ADD COLUMN "search_count" integer;--> statement-breakpoint
CREATE INDEX "response_provider_created_at_idx" ON "response" USING btree ("provider","created_at");--> statement-breakpoint
ALTER TABLE "response" ADD CONSTRAINT "response_search_count_non_negative" CHECK ("response"."search_count" >= 0);