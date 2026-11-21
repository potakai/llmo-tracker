CREATE TYPE "public"."prompt_kind" AS ENUM('question', 'keyword');--> statement-breakpoint
ALTER TABLE "prompt" ADD COLUMN "kind" "prompt_kind" DEFAULT 'question' NOT NULL;