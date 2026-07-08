import { z } from "zod";
import cron from "node-cron";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const systemSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100),
    slug: z
      .string()
      .trim()
      .min(1, "Slug is required")
      .max(60)
      .regex(slugRegex, "Slug must be lowercase letters, numbers, and hyphens"),
    description: z.string().trim().max(500).optional().or(z.literal("")),
    enabled: z.boolean().default(true),

    scheduleUrl: z.string().trim().url("Must be a valid URL"),
    scheduleToken: z.string().optional(), // blank on edit = unchanged
    scheduleHeaderName: z.string().trim().min(1).default("x-api-key"),

    ringGroupPrefix: z
      .string()
      .trim()
      .min(1, "Ring group prefix is required")
      .regex(/^\d+$/, "Ring group prefix must be numeric"),
    callerId: z.string().trim().max(50).optional().or(z.literal("")),
    ringStrategy: z.string().trim().min(1).default("ringall"),
    ringTimeSingle: z.coerce.number().int().min(1).max(600).default(60),
    ringTimeMulti: z.coerce.number().int().min(1).max(600).default(30),
    descriptionTemplate: z.string().trim().min(1).default("DiALERT {name} {n}"),
    maintainStructure: z.boolean().default(false),
    keepEntryGroup: z.boolean().default(false),
    entryGroupMode: z.enum(["forward", "mirror"]).default("forward"),
    internalExtMinLen: z.number().int().min(1).max(20).nullable().default(null),
    internalExtMaxLen: z.number().int().min(1).max(20).nullable().default(null),
    // Declared tiers (maintain mode). tierCount drives the config UI; tierConfig
    // holds per-tier forced-empty / forced-destination overrides.
    tierCount: z.number().int().min(1).max(20).nullable().default(null),
    tierConfig: z
      .record(
        z.string(),
        z.object({
          forceEmpty: z.boolean().optional(),
          destType: z.enum(["next", "ring_group", "extension", "terminate"]).optional(),
          destValue: z.string().optional(),
          destSubtype: z.string().optional(),
        }),
      )
      .default({}),
    // Per-tier ring time overrides keyed by tier number.
    ringTimeOverrides: z
      .record(z.string(), z.coerce.number().int().min(1).max(600))
      .default({}),

    finalDestType: z
      .enum(["terminate", "ring_group", "extension", "voicemail", "external"])
      .default("terminate"),
    finalDestValue: z.string().trim().max(50).optional().or(z.literal("")),
    finalDestSubtype: z.string().trim().max(30).optional().or(z.literal("")),

    cronString: z.string().trim().min(1, "Cron string is required"),
    timezone: z.string().trim().min(1).default("America/New_York"),
  })
  .superRefine((data, ctx) => {
    if (!cron.validate(data.cronString)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cronString"],
        message: "Invalid cron expression",
      });
    }
    // Non-terminate destinations need a target value.
    if (data.finalDestType !== "terminate" && !data.finalDestValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["finalDestValue"],
        message: "A target value is required for this destination type",
      });
    }
    // Override tier keys must be positive integers.
    for (const key of Object.keys(data.ringTimeOverrides)) {
      if (!/^\d+$/.test(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ringTimeOverrides"],
          message: `Invalid tier number "${key}" in ring time overrides`,
        });
      }
    }
    // Internal extension length range must be ordered.
    if (
      data.internalExtMinLen != null &&
      data.internalExtMaxLen != null &&
      data.internalExtMinLen > data.internalExtMaxLen
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["internalExtMaxLen"],
        message: "Max length must be greater than or equal to min length",
      });
    }
    // A forced ring-group/extension tier destination needs a target value.
    for (const [tier, c] of Object.entries(data.tierConfig)) {
      if ((c.destType === "ring_group" || c.destType === "extension") && !c.destValue?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tierConfig"],
          message: `Tier ${tier}: a ${c.destType.replace("_", " ")} destination needs a target value`,
        });
      }
    }
  });

export type SystemInput = z.infer<typeof systemSchema>;

/** Parse a browser FormData object into a typed, validated system input. */
export function parseSystemForm(form: FormData) {
  const toIntOrNull = (v: FormDataEntryValue | null): number | null => {
    const s = (v ?? "").toString().trim();
    if (!s) return null;
    return Number(s); // NaN if non-numeric -> fails z.number()
  };

  // Declared tier config comes as a single hidden JSON field.
  let tierConfig: unknown = {};
  const tierConfigRaw = form.get("tierConfigJson");
  if (tierConfigRaw) {
    try {
      tierConfig = JSON.parse(String(tierConfigRaw));
    } catch {
      tierConfig = {};
    }
  }

  // Paired arrays of tier number / seconds from the dynamic overrides editor.
  const tiers = form.getAll("overrideTier").map((v) => String(v).trim());
  const seconds = form.getAll("overrideSeconds").map((v) => String(v).trim());
  const ringTimeOverrides: Record<string, string> = {};
  for (let i = 0; i < tiers.length; i++) {
    if (!tiers[i] && !seconds[i]) continue; // skip fully-empty rows
    ringTimeOverrides[tiers[i]] = seconds[i];
  }

  const raw = {
    name: form.get("name"),
    slug: form.get("slug"),
    description: form.get("description") ?? "",
    enabled: form.get("enabled") === "on" || form.get("enabled") === "true",
    scheduleUrl: form.get("scheduleUrl"),
    scheduleToken: form.get("scheduleToken") ?? "",
    scheduleHeaderName: form.get("scheduleHeaderName") || "x-api-key",
    ringGroupPrefix: form.get("ringGroupPrefix"),
    callerId: form.get("callerId") ?? "",
    ringStrategy: form.get("ringStrategy") || "ringall",
    ringTimeSingle: form.get("ringTimeSingle") ?? 60,
    ringTimeMulti: form.get("ringTimeMulti") ?? 30,
    descriptionTemplate: form.get("descriptionTemplate") || "DiALERT {name} {n}",
    maintainStructure: form.get("maintainStructure") === "on" || form.get("maintainStructure") === "true",
    keepEntryGroup: form.get("keepEntryGroup") === "on" || form.get("keepEntryGroup") === "true",
    entryGroupMode: form.get("entryGroupMode") || "forward",
    internalExtMinLen: toIntOrNull(form.get("internalExtMinLen")),
    internalExtMaxLen: toIntOrNull(form.get("internalExtMaxLen")),
    tierCount: toIntOrNull(form.get("tierCount")),
    tierConfig,
    ringTimeOverrides,
    finalDestType: form.get("finalDestType") || "terminate",
    finalDestValue: form.get("finalDestValue") ?? "",
    finalDestSubtype: form.get("finalDestSubtype") ?? "",
    cronString: form.get("cronString"),
    timezone: form.get("timezone") || "America/New_York",
  };
  return systemSchema.safeParse(raw);
}
