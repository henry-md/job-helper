import OpenAI, { toFile } from "openai";
import type { SystemPromptSettings } from "@/lib/system-prompt-settings";
import { validateTailorResumeLatexDocument } from "@/lib/tailor-resume-link-validation";
import {
  resumeLatexValidationTool,
  runResumeLatexToolLoop,
  type RunResumeLatexToolLoopResult,
} from "@/lib/tailor-resume-extraction-loop";
import {
  buildExtractedResumeLinksFromLatex,
  buildResumeExtractionInput,
  buildResumeLatexInstructions,
  buildResumeRetryInput,
} from "@/lib/tailor-resume-extraction-request";
import { buildTailorResumeLinkRecords } from "@/lib/tailor-resume-links";
import { applyTailorResumeLinkOverridesWithSummary } from "@/lib/tailor-resume-link-overrides";
import { getRetryAttemptsToGenerateLatexFromPdf } from "@/lib/tailor-resume-retry-config";
import { tailorResumeLatexExample } from "@/lib/tailor-resume-latex-example";
import { extractEmbeddedPdfLinks } from "@/lib/tailor-resume-pdf-links";
import type {
  TailorResumeLinkRecord,
  TailorResumeSavedLinkUpdate,
} from "@/lib/tailor-resume-types";

const TEST_OPENAI_RESPONSE_MODEL = "test-openai-response";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  return new OpenAI({ apiKey });
}

function isTestOpenAIResponseEnabled() {
  const value = process.env.TEST_OPENAI_RESPONSE?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export type ExtractResumeLatexDocumentResult = RunResumeLatexToolLoopResult & {
  resumeLinks: TailorResumeLinkRecord[];
  savedLinkUpdateCount: number;
  savedLinkUpdates: TailorResumeSavedLinkUpdate[];
};

type ExtractResumeLatexDocumentDependencies = {
  client?: OpenAI;
  extractPdfLinks?: typeof extractEmbeddedPdfLinks;
  knownLinks?: TailorResumeLinkRecord[];
  onAttemptEvent?: (
    attemptEvent: RunResumeLatexToolLoopResult["attemptEvents"][number],
  ) => void | Promise<void>;
  onBuildFailure?: (latexCode: string, error: string, attempt: number) => Promise<void>;
  preserveUnusedKnownLinks?: boolean;
  promptSettings?: SystemPromptSettings;
  validateLatexDocument?: (
    latexCode: string,
  ) => ReturnType<typeof validateTailorResumeLatexDocument>;
};

export async function extractResumeLatexDocument(
  input: {
    buffer: Buffer;
    filename: string;
    mimeType: string;
  },
  dependencies: ExtractResumeLatexDocumentDependencies = {},
): Promise<ExtractResumeLatexDocumentResult> {
  const model = process.env.OPENAI_RESUME_EXTRACTION_MODEL ?? "gpt-5-mini";
  const retryAttempts = getRetryAttemptsToGenerateLatexFromPdf();
  const extractPdfLinks = dependencies.extractPdfLinks ?? extractEmbeddedPdfLinks;
  const knownLinks = dependencies.knownLinks ?? [];
  const preserveUnusedKnownLinks =
    dependencies.preserveUnusedKnownLinks ?? true;
  const validateLatexDocument =
    dependencies.validateLatexDocument ?? validateTailorResumeLatexDocument;
  const applySavedLinkOverrides = (latexCode: string) =>
    applyTailorResumeLinkOverridesWithSummary(latexCode, knownLinks);
  const validateLatexWithOverrides = (latexCode: string) =>
    validateLatexDocument(applySavedLinkOverrides(latexCode).latexCode);
  const embeddedPdfLinks =
    input.mimeType === "application/pdf" ? await extractPdfLinks(input.buffer) : [];

  if (isTestOpenAIResponseEnabled()) {
    try {
      const finalizedLatex = applySavedLinkOverrides(tailorResumeLatexExample);
      const validation = await validateLatexWithOverrides(tailorResumeLatexExample);
      const extractedResumeLinks = buildExtractedResumeLinksFromLatex(
        tailorResumeLatexExample,
      );
      const resumeLinks = buildTailorResumeLinkRecords({
        existingLinks: knownLinks,
        extractedLinks: extractedResumeLinks,
        preserveUnusedExisting: preserveUnusedKnownLinks,
      });

      if (!validation.ok) {
        await dependencies.onAttemptEvent?.({
          attempt: 1,
          error: validation.error,
          linkSummary: validation.linkSummary,
          outcome: "failed",
          willRetry: false,
        });

        return {
          attempts: 1,
          attemptEvents: [
            {
              attempt: 1,
              error: validation.error,
              linkSummary: validation.linkSummary,
              outcome: "failed",
              willRetry: false,
            },
          ],
          latexCode: finalizedLatex.latexCode,
          links: validation.links,
          linkSummary: validation.linkSummary,
          model: TEST_OPENAI_RESPONSE_MODEL,
          previewPdf: null,
          extractedResumeLinks,
          resumeLinks,
          savedLinkUpdateCount: finalizedLatex.updatedCount,
          savedLinkUpdates: finalizedLatex.updatedLinks,
          validationError: validation.error,
        };
      }

      await dependencies.onAttemptEvent?.({
        attempt: 1,
        error: null,
        linkSummary: validation.linkSummary,
        outcome: "succeeded",
        willRetry: false,
      });

      return {
        attempts: 1,
        attemptEvents: [
          {
            attempt: 1,
            error: null,
            linkSummary: validation.linkSummary,
            outcome: "succeeded",
            willRetry: false,
          },
        ],
        latexCode: finalizedLatex.latexCode,
        links: validation.links,
        linkSummary: validation.linkSummary,
        model: TEST_OPENAI_RESPONSE_MODEL,
        previewPdf: validation.previewPdf,
        extractedResumeLinks,
        resumeLinks,
        savedLinkUpdateCount: finalizedLatex.updatedCount,
        savedLinkUpdates: finalizedLatex.updatedLinks,
        validationError: null,
      };
    } catch (error) {
      const finalizedLatex = applySavedLinkOverrides(tailorResumeLatexExample);
      const extractedResumeLinks = buildExtractedResumeLinksFromLatex(
        tailorResumeLatexExample,
      );
      const attemptError =
        error instanceof Error
          ? error.message
          : "Unable to compile the test LaTeX document.";

      await dependencies.onAttemptEvent?.({
        attempt: 1,
        error: attemptError,
        linkSummary: null,
        outcome: "failed",
        willRetry: false,
      });

      return {
        attempts: 1,
        attemptEvents: [
          {
            attempt: 1,
            error: attemptError,
            linkSummary: null,
            outcome: "failed",
            willRetry: false,
          },
        ],
        latexCode: finalizedLatex.latexCode,
        links: [],
        linkSummary: null,
        model: TEST_OPENAI_RESPONSE_MODEL,
        previewPdf: null,
        extractedResumeLinks,
        resumeLinks: buildTailorResumeLinkRecords({
          existingLinks: knownLinks,
          extractedLinks: extractedResumeLinks,
          preserveUnusedExisting: preserveUnusedKnownLinks,
        }),
        savedLinkUpdateCount: finalizedLatex.updatedCount,
        savedLinkUpdates: finalizedLatex.updatedLinks,
        validationError: attemptError,
      };
    }
  }

  const client = dependencies.client ?? getOpenAIClient();
  const uploadedFile = input.mimeType.startsWith("image/")
    ? null
    : await client.files.create({
        file: await toFile(input.buffer, input.filename, {
          type: input.mimeType,
        }),
        purpose: "user_data",
      });

  try {
    const result = await runResumeLatexToolLoop({
      createResponse: async ({
        attempt,
        previousResponseId,
        input: retryInput,
      }) => {
        const responseInput = retryInput
          ? buildResumeRetryInput(
              input,
              uploadedFile?.id ?? null,
              {
                embeddedPdfLinks,
                knownLinks,
              },
              retryInput,
            )
          : buildResumeExtractionInput(input, uploadedFile?.id ?? null, {
              embeddedPdfLinks,
              knownLinks,
            });
        const response = await client.responses.create({
          model,
          instructions: buildResumeLatexInstructions({
            attempt,
            maxAttempts: retryAttempts,
            promptSettings: dependencies.promptSettings,
          }),
          input: responseInput,
          parallel_tool_calls: false,
          previous_response_id: retryInput ? undefined : previousResponseId,
          tool_choice: "required",
          tools: [resumeLatexValidationTool],
        });

        return {
          id: response.id,
          model: response.model ?? undefined,
          output: response.output.map((outputItem) => {
            const mappedItem: {
              arguments?: string;
              call_id?: string;
              content?: Array<{ type?: string; text?: string }>;
              name?: string;
              type?: string;
            } = {
              type: outputItem.type,
            };

            if ("name" in outputItem && typeof outputItem.name === "string") {
              mappedItem.name = outputItem.name;
            }

            if ("call_id" in outputItem && typeof outputItem.call_id === "string") {
              mappedItem.call_id = outputItem.call_id;
            }

            if (
              "arguments" in outputItem &&
              typeof outputItem.arguments === "string"
            ) {
              mappedItem.arguments = outputItem.arguments;
            }

            if ("content" in outputItem && Array.isArray(outputItem.content)) {
              mappedItem.content = outputItem.content.map((contentItem) => {
                const mappedContent: { type?: string; text?: string } = {};

                if ("type" in contentItem && typeof contentItem.type === "string") {
                  mappedContent.type = contentItem.type;
                }

                if ("text" in contentItem && typeof contentItem.text === "string") {
                  mappedContent.text = contentItem.text;
                }

                return mappedContent;
              });
            }

            return mappedItem;
          }),
          output_text: response.output_text,
        };
      },
      fallbackModel: model,
      maxAttempts: retryAttempts,
      onAttemptEvent: dependencies.onAttemptEvent,
      onBuildFailure: dependencies.onBuildFailure,
      validateLatex: validateLatexWithOverrides,
    });

    const finalizedLatex = applySavedLinkOverrides(result.latexCode);

    return {
      ...result,
      latexCode: finalizedLatex.latexCode,
      resumeLinks: buildTailorResumeLinkRecords({
        existingLinks: knownLinks,
        extractedLinks: result.extractedResumeLinks,
        preserveUnusedExisting: preserveUnusedKnownLinks,
      }),
      savedLinkUpdateCount: finalizedLatex.updatedCount,
      savedLinkUpdates: finalizedLatex.updatedLinks,
    };
  } finally {
    if (uploadedFile?.id) {
      await client.files.delete(uploadedFile.id);
    }
  }
}
