// Maps a system's configured "final destination" (what happens when the last
// ring-group tier goes unanswered) to a FreePBX `postAnswer` destination string.
//
// FreePBX destination strings are "<module>,<id>,<priority>". The values below
// cover the common cases; add more as needed.

export type FinalDestType =
  | "terminate"
  | "ring_group"
  | "extension"
  | "voicemail"
  | "external";

export type TerminateSubtype = "hangup" | "busy" | "congestion" | "ring";

export interface FinalDestination {
  type: FinalDestType;
  value?: string | null; // ring group number / extension / external number / vm box
  subtype?: string | null; // terminate subtype or voicemail mode
}

export const TERMINATE_SUBTYPES: TerminateSubtype[] = [
  "hangup",
  "busy",
  "congestion",
  "ring",
];

export const FINAL_DEST_TYPES: { value: FinalDestType; label: string }[] = [
  { value: "terminate", label: "Terminate the call" },
  { value: "ring_group", label: "Another ring group" },
  { value: "extension", label: "An extension" },
  { value: "voicemail", label: "Voicemail box" },
  { value: "external", label: "External number" },
];

/**
 * Build the FreePBX destination string for a final destination.
 * Throws if the configuration is incomplete so callers surface a clear error.
 */
export function toPostAnswer(dest: FinalDestination): string {
  switch (dest.type) {
    case "terminate": {
      const sub = (dest.subtype as TerminateSubtype) || "hangup";
      // app-blackhole targets: hangup, busy, congestion, ring, etc.
      return `app-blackhole,${sub},1`;
    }
    case "ring_group": {
      if (!dest.value) throw new Error("Ring group destination requires a group number");
      return `ext-group,${dest.value},1`;
    }
    case "extension": {
      if (!dest.value) throw new Error("Extension destination requires an extension number");
      return `from-did-direct,${dest.value},1`;
    }
    case "voicemail": {
      if (!dest.value) throw new Error("Voicemail destination requires a mailbox number");
      // Default to "unavailable" greeting mode; subtype may override (u/b/s/i).
      const mode = dest.subtype || "u";
      return `ext-local,vm${mode}${dest.value},1`;
    }
    case "external": {
      if (!dest.value) throw new Error("External destination requires a phone number");
      // Route out via the standard outbound context.
      return `from-internal,${dest.value},1`;
    }
    default:
      throw new Error(`Unknown final destination type: ${dest.type}`);
  }
}

/** Human-readable summary for the UI / logs. */
export function describeDestination(dest: FinalDestination): string {
  switch (dest.type) {
    case "terminate":
      return `Terminate (${dest.subtype || "hangup"})`;
    case "ring_group":
      return `Ring group ${dest.value ?? "?"}`;
    case "extension":
      return `Extension ${dest.value ?? "?"}`;
    case "voicemail":
      return `Voicemail ${dest.value ?? "?"}`;
    case "external":
      return `External ${dest.value ?? "?"}`;
    default:
      return "Unknown";
  }
}
