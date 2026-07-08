-- AlterTable
ALTER TABLE "systems" ADD COLUMN "entryGroupMode" TEXT NOT NULL DEFAULT 'forward';
ALTER TABLE "systems" ADD COLUMN "internalExtMinLen" INTEGER;
ALTER TABLE "systems" ADD COLUMN "internalExtMaxLen" INTEGER;
