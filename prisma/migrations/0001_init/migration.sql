-- CreateTable
CREATE TABLE "systems" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleUrl" TEXT NOT NULL,
    "scheduleToken" TEXT,
    "scheduleHeaderName" TEXT NOT NULL DEFAULT 'x-api-key',
    "ringGroupPrefix" TEXT NOT NULL,
    "callerId" TEXT,
    "ringStrategy" TEXT NOT NULL DEFAULT 'ringall',
    "ringTimeSingle" INTEGER NOT NULL DEFAULT 60,
    "ringTimeMulti" INTEGER NOT NULL DEFAULT 30,
    "descriptionTemplate" TEXT NOT NULL DEFAULT 'DiALERT {name} {n}',
    "finalDestType" TEXT NOT NULL DEFAULT 'terminate',
    "finalDestValue" TEXT,
    "finalDestSubtype" TEXT,
    "cronString" TEXT NOT NULL DEFAULT '* * * * *',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "pbxApiUrl" TEXT,
    "pbxGqlUrl" TEXT,
    "pbxClientId" TEXT,
    "pbxClientSecret" TEXT,
    "pbxScope" TEXT,
    "triggerToken" TEXT,
    "lastHash" TEXT,
    "lastAppliedAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apply_events" (
    "id" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apply_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "systems_slug_key" ON "systems"("slug");

-- CreateIndex
CREATE INDEX "apply_events_systemId_createdAt_idx" ON "apply_events"("systemId", "createdAt");

-- AddForeignKey
ALTER TABLE "apply_events" ADD CONSTRAINT "apply_events_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "systems"("id") ON DELETE CASCADE ON UPDATE CASCADE;
