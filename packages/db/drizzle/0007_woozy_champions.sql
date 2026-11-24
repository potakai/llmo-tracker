CREATE TYPE "public"."check_status" AS ENUM('ok', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."site_audit_page_source" AS ENUM('top', 'cited', 'sitemap', 'link');--> statement-breakpoint
CREATE TYPE "public"."site_audit_page_status" AS ENUM('pending', 'fetched', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."site_audit_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."site_mode" AS ENUM('live', 'fake');--> statement-breakpoint
CREATE TABLE "site_audit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"mode" "site_mode" NOT NULL,
	"status" "site_audit_status" DEFAULT 'queued' NOT NULL,
	"requested_on" date NOT NULL,
	"domain" text NOT NULL,
	"site_facts" jsonb,
	"planned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_audit_failed_has_error" CHECK ("site_audit"."status" <> 'failed' or "site_audit"."error" is not null)
);
--> statement-breakpoint
CREATE TABLE "site_audit_check" (
	"id" uuid PRIMARY KEY NOT NULL,
	"audit_id" uuid NOT NULL,
	"page_id" uuid,
	"key" text NOT NULL,
	"status" "check_status" NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	CONSTRAINT "site_audit_check_audit_id_page_id_key_uq" UNIQUE NULLS NOT DISTINCT("audit_id","page_id","key")
);
--> statement-breakpoint
CREATE TABLE "site_audit_page" (
	"id" uuid PRIMARY KEY NOT NULL,
	"audit_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source" "site_audit_page_source" NOT NULL,
	"position" smallint NOT NULL,
	"status" "site_audit_page_status" DEFAULT 'pending' NOT NULL,
	"http_status" smallint,
	"final_url" text,
	"facts" jsonb,
	"error" text,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "site_audit" ADD CONSTRAINT "site_audit_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_check" ADD CONSTRAINT "site_audit_check_audit_id_site_audit_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_check" ADD CONSTRAINT "site_audit_check_page_id_site_audit_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."site_audit_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_audit_page" ADD CONSTRAINT "site_audit_page_audit_id_site_audit_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."site_audit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_audit_brand_id_created_at_idx" ON "site_audit" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_audit_brand_id_trigger_requested_on_uq" ON "site_audit" USING btree ("brand_id","trigger","requested_on");--> statement-breakpoint
CREATE UNIQUE INDEX "site_audit_one_active_per_brand_uq" ON "site_audit" USING btree ("brand_id") WHERE "site_audit"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "site_audit_page_audit_id_url_uq" ON "site_audit_page" USING btree ("audit_id","url");--> statement-breakpoint
CREATE INDEX "site_audit_page_audit_id_status_idx" ON "site_audit_page" USING btree ("audit_id","status");