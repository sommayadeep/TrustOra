/** Small deterministic source scanner used by the paid demo service. */
export type ScanFinding = { ruleId: string; severity: "HIGH" | "MEDIUM"; file: string; line: number; message: string };
export type ScanResult = { filesScanned: number; findings: ScanFinding[]; summary: { high: number; medium: number } };

const RULES: Array<{ id: string; severity: ScanFinding["severity"]; pattern: RegExp; message: string }> = [
  { id: "JS-EVAL", severity: "HIGH", pattern: /\beval\s*\(/, message: "Dynamic code evaluation can execute attacker-controlled input." },
  { id: "JS-CHILD-PROCESS", severity: "HIGH", pattern: /\bexec(?:Sync)?\s*\(\s*[^,]*\$\{|\bexec(?:Sync)?\s*\(\s*[^,]*\+/, message: "Shell command appears to be assembled from dynamic input." },
  { id: "JS-HARDCODED-SECRET", severity: "HIGH", pattern: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'`][A-Za-z0-9_\-]{12,}["'`]/i, message: "A credential-like value appears to be hard-coded." },
  { id: "REACT-HTML-INJECTION", severity: "HIGH", pattern: /dangerouslySetInnerHTML\s*=/, message: "Raw HTML injection bypasses React's normal escaping." },
  { id: "SQL-CONCAT", severity: "MEDIUM", pattern: /(?:SELECT|INSERT|UPDATE|DELETE)[^\n]*(?:\+\s*[A-Za-z_$]|\$\{)/i, message: "SQL text appears to include string interpolation or concatenation." },
];

export function validateScanInput(input: unknown): asserts input is Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Provide a files object mapping file paths to source text");
  const files = Object.entries(input as Record<string, unknown>);
  if (files.length < 1 || files.length > 40) throw new Error("Provide between 1 and 40 source files");
  let totalBytes = 0;
  for (const [file, value] of files) {
    if (!/^[\w./-]{1,180}$/.test(file) || file.includes("..") || typeof value !== "string") throw new Error("Each file needs a safe relative path and source text");
    totalBytes += Buffer.byteLength(value, "utf8");
    if (totalBytes > 512_000) throw new Error("Source input exceeds the 512 KB scan limit");
  }
}

export function scanSourceFiles(input: unknown): ScanResult {
  validateScanInput(input);
  const files = Object.entries(input);
  const findings: ScanFinding[] = [];
  for (const [file, value] of files) {
    const lines = value.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of RULES) if (rule.pattern.test(line)) findings.push({ ruleId: rule.id, severity: rule.severity, file, line: index + 1, message: rule.message });
    });
  }
  return { filesScanned: files.length, findings, summary: { high: findings.filter((f) => f.severity === "HIGH").length, medium: findings.filter((f) => f.severity === "MEDIUM").length } };
}

/** Shared gate: service code cannot run for facilitator-only or pending states. */
export function executePaidScanAfterVerification(status: string, input: unknown): ScanResult | null {
  if (status !== "VERIFIED") return null;
  return scanSourceFiles(input);
}
