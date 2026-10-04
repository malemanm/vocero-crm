CREATE TABLE "ycloud_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"phone" text NOT NULL,
	"waba_id" text,
	"webhook_id" text,
	"webhook_status" text DEFAULT 'pending' NOT NULL,
	"api_key_cipher" text NOT NULL,
	"api_key_iv" text NOT NULL,
	"api_key_tag" text NOT NULL,
	"webhook_secret_cipher" text,
	"webhook_secret_iv" text,
	"webhook_secret_tag" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ycloud_credentials" ADD CONSTRAINT "ycloud_credentials_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ycloud_credentials_org_uq" ON "ycloud_credentials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ycloud_credentials_phone_uq" ON "ycloud_credentials" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "ycloud_credentials" ENABLE ROW LEVEL SECURITY;
