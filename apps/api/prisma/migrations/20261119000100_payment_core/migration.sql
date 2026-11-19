-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('CREATED', 'PENDING', 'FAILED', 'SUCCEEDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "provisioning_status" AS ENUM ('NOT_STARTED', 'READY', 'RETRYABLE', 'BLOCKED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "payment_event_type" AS ENUM ('PAYMENT_CREATED', 'PAYMENT_STATUS_CHANGED', 'PROVIDER_RETRY_SCHEDULED', 'PROVIDER_BLOCKED', 'REVIEW_REQUIRED', 'WEBHOOK_PROCESSING_FAILED', 'SYNC_NO_CHANGE');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'CREATED',
    "status_version" INTEGER NOT NULL DEFAULT 1,
    "provider_operation_key" TEXT NOT NULL,
    "provisioning_status" "provisioning_status" NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY NOT NULL,
    "payment_id" UUID NOT NULL,
    "type" "payment_event_type" NOT NULL,
    "from_status" "payment_status",
    "to_status" "payment_status",
    "status_version" INTEGER,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_operation_key_key" ON "payments"("provider_operation_key");

-- CreateIndex
CREATE INDEX "payments_created_at_id_idx" ON "payments"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "payments_status_created_at_id_idx" ON "payments"("status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_payment_id_key" ON "idempotency_records"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_id_idx" ON "payment_events"("payment_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_payment_id_status_version_key" ON "payment_events"("payment_id", "status_version");

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot express these PostgreSQL checks. Keep them in this migration.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK (amount BETWEEN 100 AND 1000000),
  ADD CONSTRAINT "payments_currency_check" CHECK (currency IN ('USD', 'EUR')),
  ADD CONSTRAINT "payments_status_version_check" CHECK (status_version >= 1),
  ADD CONSTRAINT "payments_operation_key_check" CHECK (provider_operation_key = 'pps:pi:create:v1:' || id::text);

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_scope_check" CHECK (scope = 'demo:create-payment:v1'),
  ADD CONSTRAINT "idempotency_key_check" CHECK (length(key) BETWEEN 16 AND 128 AND key COLLATE "C" ~ '^[A-Za-z0-9._:-]+$'),
  ADD CONSTRAINT "idempotency_hash_check" CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "idempotency_status_check" CHECK (response_status = 201);

ALTER TABLE "payment_events"
  ADD CONSTRAINT "payment_events_version_check" CHECK (status_version IS NULL OR status_version >= 1),
  ADD CONSTRAINT "payment_events_transition_check" CHECK (
    (type = 'PAYMENT_CREATED' AND from_status IS NULL AND to_status IS NOT NULL AND to_status = 'CREATED' AND status_version IS NOT NULL AND status_version = 1)
    OR (type = 'PAYMENT_STATUS_CHANGED' AND from_status IS NOT NULL AND to_status IS NOT NULL AND from_status <> to_status AND status_version IS NOT NULL AND status_version > 1)
    OR (type NOT IN ('PAYMENT_CREATED', 'PAYMENT_STATUS_CHANGED') AND status_version IS NULL AND from_status IS NULL AND to_status IS NULL)
  );

