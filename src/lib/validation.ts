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
  });

export type SystemInput = z.infer<typeof systemSchema>;

/** Parse a browser FormData object into a typed, validated system input. */
export function parseSystemForm(form: FormData) {
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
    finalDestType: form.get("finalDestType") || "terminate",
    finalDestValue: form.get("finalDestValue") ?? "",
    finalDestSubtype: form.get("finalDestSubtype") ?? "",
    cronString: form.get("cronString"),
    timezone: form.get("timezone") || "America/New_York",
  };
  return systemSchema.safeParse(raw);
}
