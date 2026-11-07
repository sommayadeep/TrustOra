-- Additive x402 ownership, reconciliation, and service-result metadata.
-- Safe for existing local databases: legacy rows remain NULL and no rows are rewritten.
-- Apply only after reviewing with `npm run db:update`; this file is not run automatically.
ALTER TABLE "AgentPayment" ADD COLUMN "requestedByAddress" TEXT;
ALTER TABLE "AgentPayment" ADD COLUMN "payerAccount" TEXT;
ALTER TABLE "AgentPayment" ADD COLUMN "projectId" TEXT;
ALTER TABLE "AgentPayment" ADD COLUMN "serviceResultJson" TEXT;
ALTER TABLE "AgentPayment" ADD COLUMN "serviceInputJson" TEXT;
