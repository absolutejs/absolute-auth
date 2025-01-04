CREATE TABLE IF NOT EXISTS "users" (
	"given_name" varchar(255),
	"family_name" varchar(255),
	"email" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"auth_sub" varchar(255) PRIMARY KEY NOT NULL,
	"picture" varchar(255)
);
