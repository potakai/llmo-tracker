CREATE TYPE "public"."run_cancel_reason" AS ENUM('schedule_disabled');--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "cancel_reason" "run_cancel_reason";