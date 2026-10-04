CREATE TABLE "media_blob" (
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "media_blob_organization_id_name_pk" PRIMARY KEY("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "media_blob" ADD CONSTRAINT "media_blob_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;