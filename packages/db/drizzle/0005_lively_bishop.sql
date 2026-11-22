CREATE TYPE "public"."serp_mode" AS ENUM('live', 'fake');--> statement-breakpoint
CREATE TYPE "public"."serp_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "serp_ai_overview_reference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"serp_result_id" uuid NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"position" smallint NOT NULL,
	"is_own_domain" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "serp_entity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"serp_result_id" uuid NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"competitor_id" uuid,
	"organic_rank" smallint,
	"organic_url" text,
	"ai_overview_mentioned" boolean,
	CONSTRAINT "serp_entity_type" CHECK (("serp_entity"."entity_type" = 'brand' and "serp_entity"."competitor_id" is null) or ("serp_entity"."entity_type" = 'competitor' and "serp_entity"."competitor_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "serp_result" (
	"id" uuid PRIMARY KEY NOT NULL,
	"prompt_id" uuid NOT NULL,
	"searched_on" date NOT NULL,
	"mode" "serp_mode" NOT NULL,
	"status" "serp_status" DEFAULT 'pending' NOT NULL,
	"task_id" text,
	"post_attempted_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	"error" text,
	"cost_usd" numeric(10, 6),
	"ai_overview_present" boolean,
	"ai_overview_asynchronous" boolean,
	"ai_overview_text" text,
	"extractor_model" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serp_result_status_payload" CHECK ("serp_result"."status" = 'pending' or ("serp_result"."status" = 'succeeded' and "serp_result"."ai_overview_present" is not null) or ("serp_result"."status" = 'failed' and "serp_result"."error" is not null))
);
--> statement-breakpoint
ALTER TABLE "serp_ai_overview_reference" ADD CONSTRAINT "serp_ai_overview_reference_serp_result_id_serp_result_id_fk" FOREIGN KEY ("serp_result_id") REFERENCES "public"."serp_result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serp_entity" ADD CONSTRAINT "serp_entity_serp_result_id_serp_result_id_fk" FOREIGN KEY ("serp_result_id") REFERENCES "public"."serp_result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serp_entity" ADD CONSTRAINT "serp_entity_competitor_id_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serp_result" ADD CONSTRAINT "serp_result_prompt_id_prompt_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serp_ai_overview_reference_serp_result_id_idx" ON "serp_ai_overview_reference" USING btree ("serp_result_id");--> statement-breakpoint
CREATE INDEX "serp_entity_serp_result_id_idx" ON "serp_entity" USING btree ("serp_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "serp_result_prompt_id_searched_on_uq" ON "serp_result" USING btree ("prompt_id","searched_on");--> statement-breakpoint
CREATE INDEX "serp_result_searched_on_status_idx" ON "serp_result" USING btree ("searched_on","status");