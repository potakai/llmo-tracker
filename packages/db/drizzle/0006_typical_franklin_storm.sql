ALTER TABLE "serp_result" ADD COLUMN "last_fetch_error" text;--> statement-breakpoint
ALTER TABLE "serp_result" ADD COLUMN "last_fetch_error_at" timestamp with time zone;