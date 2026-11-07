import {
  ADVISORY_NOTICE,
  Evaluator,
  MAX_DELIVERABLE_CHARS,
  canonicalJson,
  sha256Hex,
} from "../../../../packages/evaluation/src/index";
import type { EvaluationReport, Verdict } from "../../../../packages/evaluation/src/index";
import { createPrivateComputerClientFromEnv } from "../../../../packages/og/src/index";
import type { OgChatClient } from "../../../../packages/og/src/index";

/** The most deliverable text the evaluator can read. Submissions are capped to this so nothing goes unassessed. */
export { MAX_DELIVERABLE_CHARS };

export interface RunEvaluationParams {
  criteriaVersion: string;
  criteria: Array<{ id: string; text: string }>;
  /** Full deliverable text (not a summary). */
  submissionContent: string;
  /** Lowercase SHA-256 hex of the deliverable. */
  submissionHash: string;
  filename?: string;
  /** The client must explicitly consent before any deliverable text is sent to an AI provider. */
  aiConsentGiven: boolean;
}

/**
 * Advisory evaluation through the 0G Private Computer Router.
 *
 * Honesty rules enforced here and in the evaluator:
 *  - No model reachable, refused, or output invalid  -> UNABLE_TO_ASSESS (never PASS), no request ID.
 *  - Request IDs, TEE flags and model IDs come only from the provider's response; nothing is generated locally.
 *  - Text the model cannot fully read is not evaluated at all (no silent truncation).
 *  - The report is advisory: it has no field or code path that releases or refunds funds.
 *
 * `deps.client` exists so tests can supply a fake provider; production uses the env-configured client.
 */
export async function run0GEvaluation(
  params: RunEvaluationParams,
  deps: { client?: OgChatClient } = {},
): Promise<EvaluationReport> {
  const criteria = params.criteria.slice(0, 10).map((c) => ({ id: c.id, text: c.text }));

  if (params.submissionContent.length > MAX_DELIVERABLE_CHARS) {
    return unableToAssess(
      params,
      criteria,
      `The deliverable is ${params.submissionContent.length.toLocaleString("en-US")} characters; the evaluator can read at most ${MAX_DELIVERABLE_CHARS.toLocaleString("en-US")}. It was not sent to a model rather than being judged on a partial read.`,
    );
  }
  if (params.criteria.length > 10) {
    return unableToAssess(params, criteria, `The agreement has ${params.criteria.length} criteria; the evaluator handles at most 10, so none were assessed.`);
  }

  try {
    const client = deps.client ?? createPrivateComputerClientFromEnv(process.env);
    if (!client) {
      return unableToAssess(params, criteria, "0G Private Computer is not configured; set ZG_ROUTER_API_KEY on the server.");
    }
    const outcome = await new Evaluator({ client }).evaluate({
      criteriaVersion: params.criteriaVersion,
      criteria,
      submission: { kind: "code", name: params.filename || "deliverable", text: params.submissionContent },
      submissionHash: params.submissionHash,
      aiConsentGiven: params.aiConsentGiven,
    });
    if (outcome.ok) return outcome.report;
    return unableToAssess(params, criteria, `${outcome.error.code}: ${outcome.error.message}`);
  } catch (err) {
    return unableToAssess(params, criteria, `0G evaluation could not run: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function unableToAssess(
  params: RunEvaluationParams,
  criteria: Array<{ id: string; text: string }>,
  reason: string,
): EvaluationReport {
  const body = {
    criteriaVersion: params.criteriaVersion,
    submissionHash: params.submissionHash,
    overall: "UNABLE_TO_ASSESS" as const,
    criteria: criteria.map((c) => ({ id: c.id, text: c.text, verdict: "UNABLE_TO_ASSESS" as Verdict, evidence: "" })),
    limitations: [reason.slice(0, 500), "No AI model assessed this deliverable. Advisory only: this report cannot release or refund funds."],
    modelCalled: false,
    attempts: 0,
    requestId: null,
    requestIdSource: null,
    chatId: null,
    modelId: null,
    providerAddress: null,
    teeVerified: null,
    teeVerifiedBy: null,
    trustModeRequested: null,
    promptHash: null,
    advisoryNotice: ADVISORY_NOTICE,
  };
  return { ...body, reportHash: sha256Hex(canonicalJson(body)) };
}
