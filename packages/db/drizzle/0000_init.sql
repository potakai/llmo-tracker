CREATE TYPE "public"."entity_type" AS ENUM('brand', 'competitor', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('openai', 'gemini');--> statement-breakpoint
CREATE TYPE "public"."result_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('scheduled', 'manual');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TABLE "analysis" (
	"response_id" uuid PRIMARY KEY NOT NULL,
	"status" "result_status" NOT NULL,
	"brand_mentioned" boolean,
	"brand_rank" smallint,
	"sentiment" "sentiment",
	"extractor_model" text NOT NULL,
	"schema_version" smallint NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"domain" text,
	"samples_per_prompt" smallint DEFAULT 5 NOT NULL,
	"providers" "provider"[] DEFAULT '{openai,gemini}'::provider[] NOT NULL,
	"schedule_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_samples_per_prompt_range" CHECK ("brand"."samples_per_prompt" between 1 and 10),
	CONSTRAINT "brand_providers_not_empty" CHECK (cardinality("brand"."providers") > 0)
);
--> statement-breakpoint
CREATE TABLE "citation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"url" text NOT NULL,
	"domain" text NOT NULL,
	"title" text,
	"position" smallint NOT NULL,
	"is_own_domain" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mention" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"entity_type" "entity_type" NOT NULL,
	"competitor_id" uuid,
	"name" text NOT NULL,
	"rank" smallint NOT NULL,
	CONSTRAINT "mention_competitor_only" CHECK ("mention"."entity_type" = 'competitor' or "mention"."competitor_id" is null)
);
--> statement-breakpoint
CREATE TABLE "prompt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"text" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_text_length" CHECK (char_length("prompt"."text") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "response" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"model" text NOT NULL,
	"sample_index" smallint NOT NULL,
	"status" "result_status" NOT NULL,
	"answer_text" text,
	"error" text,
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "response_sample_index_non_negative" CHECK ("response"."sample_index" >= 0),
	CONSTRAINT "response_status_payload" CHECK (("response"."status" = 'succeeded' and "response"."answer_text" is not null) or ("response"."status" = 'failed' and "response"."error" is not null))
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"scheduled_for" date,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"total_cost_usd" numeric(10, 4) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_scheduled_for_matches_trigger" CHECK (("run"."trigger" = 'scheduled') = ("run"."scheduled_for" is not null))
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis" ADD CONSTRAINT "analysis_response_id_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."response"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citation" ADD CONSTRAINT "citation_response_id_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."response"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor" ADD CONSTRAINT "competitor_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_response_id_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."response"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_competitor_id_competitor_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitor"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt" ADD CONSTRAINT "prompt_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response" ADD CONSTRAINT "response_run_id_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response" ADD CONSTRAINT "response_prompt_id_prompt_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_brand_id_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brand"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_organization_id_idx" ON "brand" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "citation_response_id_idx" ON "citation" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "citation_domain_idx" ON "citation" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_brand_id_name_uq" ON "competitor" USING btree ("brand_id","name");--> statement-breakpoint
CREATE INDEX "mention_response_id_idx" ON "mention" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "mention_competitor_id_idx" ON "mention" USING btree ("competitor_id");--> statement-breakpoint
CREATE INDEX "prompt_brand_id_idx" ON "prompt" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "response_run_prompt_provider_sample_uq" ON "response" USING btree ("run_id","prompt_id","provider","sample_index");--> statement-breakpoint
CREATE INDEX "response_prompt_id_created_at_idx" ON "response" USING btree ("prompt_id","created_at");--> statement-breakpoint
CREATE INDEX "run_brand_id_created_at_idx" ON "run" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "run_brand_id_scheduled_for_uq" ON "run" USING btree ("brand_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");