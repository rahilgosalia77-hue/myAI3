// app/api/route.ts (or wherever your route file is located)
// Handles file analysis for images and PDFs and falls back to LLM conversation flow.

import {
  streamText,
  UIMessage,
  convertToModelMessages,
  stepCountIs,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { MODEL } from "@/config";
import { SYSTEM_PROMPT } from "@/prompts";
import { isContentFlagged } from "@/lib/moderation";
import { webSearch } from "./tools/web-search";
import { vectorDatabaseSearch } from "./tools/search-vector-database";

import pdfParse from "pdf-parse"; // npm i pdf-parse

export const maxDuration = 30;

function hasTextPart(p: unknown): p is { text: string } {
  return Boolean(p && typeof (p as any).text === "string");
}

function extractTextFromParts(maybeParts: unknown): string {
  if (!Array.isArray(maybeParts)) return "";
  return maybeParts
    .filter((p) => (p as any).type === "text" && hasTextPart(p))
    .map((p) => (p as any).text)
    .join("");
}

/**
 * Send base64 image data to the OpenAI Responses Vision model for OCR/summary.
 * The Responses API expects the image field as `{ type: 'input_image', image: '<base64>' }`
 */
async function analyzeImageWithVision(base64: string, filename: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const promptText =
    "Extract all human-readable text from the image (OCR). Then provide a 2-line plain-language summary. " +
    "Return a JSON object with keys `ocr_text` and `summary` only.";

  const payload = {
    model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini-vision",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: promptText },
          { type: "input_image", image: base64 },
        ],
      },
    ],
    max_output_tokens: 1000,
    temperature: 0,
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Vision API error: ${resp.status} ${errText}`);
  }
  const j = await resp.json();

  // Responses API sometimes returns structured content or plain output_text
  let combined = "";
  if (j?.output?.[0]?.content) {
    combined = j.output[0].content
      .map((c: any) => c.text || c.description || "")
      .filter(Boolean)
      .join("\n");
  }
  if (!combined && j.output_text) combined = j.output_text;
  if (!combined) combined = JSON.stringify(j);

  return `OpenAI vision analysis for "${filename}":\n\n${combined}`;
}

/**
 * Extract text from a PDF buffer using pdf-parse and then call the Responses API
 * (text model) to summarize / extract structured output.
 */
async function analyzePdfBuffer(buf: Buffer, filename: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  // Extract text using pdf-parse
  let pdfText = "";
  try {
    const data = await pdfParse(buf);
    // pdf-parse returns { text, info, metadata, version, numpages }
    pdfText = (data && (data as any).text) || "";
  } catch (err) {
    console.error("pdf-parse failed:", err);
    throw new Error(`Failed to extract text from PDF "${filename}": ${String(err)}`);
  }

  if (!pdfText.trim()) {
    // If PDF had no selectable text, fall back to sending image to vision (optional).
    // We'll return a clear message so UI can guide the user.
    return `PDF "${filename}" contains no selectable text (image-only PDF). Try uploading a scanned image or ask to run OCR.`;
  }

  // If text extracted is long, optionally truncate or chunk. For simplicity, we'll send first N chars
  const maxCharsForPrompt = 28000; // safe guard (adjust)
  const textToSend = pdfText.length > maxCharsForPrompt ? pdfText.slice(0, maxCharsForPrompt) + "\n\n[TRUNCATED]" : pdfText;

  // Prompt for the Responses API (text model)
  const promptText = `I have extracted the full text of a PDF. Perform the following:
1) Provide a short (2-line) plain-language summary.
2) List 6 key bullet points (concise).
3) If relevant, list any safety/operational issues or flags found.
Return a JSON object with keys: summary, bullets (array), safety_flags (array). Use the provided text as the source.
Do not include the entire document in the summary.`;

  const payload = {
    model: MODEL || "gpt-4o-mini", // fallback model
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: promptText },
          { type: "input_text", text: textToSend },
        ],
      },
    ],
    max_output_tokens: 800,
    temperature: 0,
  };

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Responses API error for PDF: ${resp.status} ${errText}`);
  }

  const j = await resp.json();
  // Normalize to string result
  let combined = "";
  if (j?.output?.[0]?.content) {
    combined = j.output[0].content
      .map((c: any) => c.text || c.description || "")
      .filter(Boolean)
      .join("\n");
  }
  if (!combined && j.output_text) combined = j.output_text;
  if (!combined) combined = JSON.stringify(j);

  return `OpenAI PDF analysis for "${filename}":\n\n${combined}`;
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const latestUserMessage = messages.filter((msg) => msg.role === "user").pop();

  if (latestUserMessage) {
    const textParts = extractTextFromParts((latestUserMessage as any).parts);

    if (textParts) {
      const moderationResult = await isContentFlagged(textParts);

      if (moderationResult.flagged) {
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = "moderation-denial-text";

            writer.write({ type: "start" });

            writer.write({ type: "text-start", id: textId });
            writer.write({
              type: "text-delta",
              id: textId,
              delta:
                moderationResult.denialMessage ||
                "Your message violates our guidelines. I can't answer that.",
            });
            writer.write({ type: "text-end", id: textId });

            writer.write({ type: "finish" });
          },
        });

        return createUIMessageStreamResponse({ stream });
      }
    }
  }

  // --- File detection (unchanged) ---
  let fileMessage: any | undefined = undefined;
  let fileMessageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as any;
    if (m && m.metadata && m.metadata.fileContent) {
      fileMessage = m;
      fileMessageIndex = i;
      break;
    }
  }

  if (fileMessage) {
    const meta = fileMessage.metadata as {
      fileName?: string;
      fileType?: string;
      fileSize?: number;
      fileContent?: string;
    };
    const fileName = meta.fileName || "uploaded-file";
    const mime = meta.fileType || "unknown";
    const sizeKB = meta.fileSize ? Math.round(meta.fileSize / 1024) : "unknown";

    // Was the file already acknowledged by the assistant after upload? If yes, don't re-ack
    const ackExistsAfter = messages.slice(fileMessageIndex + 1).some((m) => {
      if (m.role !== "assistant" || !Array.isArray((m as any).parts)) return false;
      const parts = (m as any).parts;
      return parts.some((part: unknown) => hasTextPart(part) && part.text.includes(`Received "${fileName}"`));
    });

    if (!ackExistsAfter) {
      // If no user command after upload, ask what to do
      const userAfter = messages.slice(fileMessageIndex + 1).filter((m) => m.role === "user");
      const latestUserAfter = userAfter.length ? userAfter[userAfter.length - 1] : null;
      const latestUserText = latestUserAfter ? extractTextFromParts((latestUserAfter as any).parts) : "";
      const wantsAnalyzeNow = /analyz|analyze|analysis|\bocr\b|\b(3)\b/i.test(latestUserText);

      if (!wantsAnalyzeNow && !latestUserAfter) {
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = "file-received-text";
            writer.write({ type: "start" });

            writer.write({ type: "text-start", id: textId });
            writer.write({
              type: "text-delta",
              id: textId,
              delta: `Received "${fileName}" (${sizeKB} KB, ${mime}). I can (1) summarize text, (2) run OCR, (3) analyze images, or (4) extract tables. What would you like me to do with this file?`,
            });
            writer.write({ type: "text-end", id: textId });
            writer.write({ type: "finish" });
          },
        });
        return createUIMessageStreamResponse({ stream });
      }
      // else if user requested analyze, fallthrough to next section
    }

    // find latest user message after file message
    const userMessagesAfter = messages.slice(fileMessageIndex + 1).filter((m) => m.role === "user");
    const latestUser = userMessagesAfter.length ? userMessagesAfter[userMessagesAfter.length - 1] : null;
    const latestUserText = latestUser ? extractTextFromParts((latestUser as any).parts) : "";

    const wantsAnalyze = /analyz|analyze|analysis|\bocr\b|\b(3)\b/i.test(latestUserText);

    if (wantsAnalyze && meta.fileContent) {
      // decode base64 to buffer:
      const base64WithPrefix = meta.fileContent as string;
      const base64 = base64WithPrefix.includes(",") ? base64WithPrefix.split(",")[1] : base64WithPrefix;
      const buffer = Buffer.from(base64, "base64");

      try {
        let analysisText = "";

        // If it's a PDF, extract text and send to text model
        if (mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
          analysisText = await analyzePdfBuffer(buffer, fileName);
        } else if (/^image\//i.test(mime) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(fileName)) {
          // For images, use vision path
          const base64ForVision = buffer.toString("base64");
          analysisText = await analyzeImageWithVision(base64ForVision, fileName);
        } else {
          // Unknown type: try to handle as text first (e.g., .txt, .csv) by decoding buffer
          const text = buffer.toString("utf8");
          if (text && text.trim().length > 0) {
            // Send to Responses API for summary
            const prompt = `Summarize the following text in 2 lines and list 4 key bullet points. Provide JSON keys: summary, bullets.\n\n${text}`;
            const payload = {
              model: MODEL || "gpt-4o-mini",
              input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
              max_output_tokens: 800,
              temperature: 0,
            };

            const resp = await fetch("https://api.openai.com/v1/responses", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });

            if (!resp.ok) {
              const errText = await resp.text();
              throw new Error(`Responses API error for text file: ${resp.status} ${errText}`);
            }
            const j = await resp.json();
            let combined = "";
            if (j?.output?.[0]?.content) {
              combined = j.output[0].content.map((c: any) => c.text || c.description || "").join("\n");
            }
            if (!combined && j.output_text) combined = j.output_text;
            if (!combined) combined = JSON.stringify(j);
            analysisText = `Analysis for "${fileName}":\n\n${combined}`;
          } else {
            analysisText = `Cannot extract text from "${fileName}". It might be a binary file type I don't support.`;
          }
        }

        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = "file-analysis-text";
            writer.write({ type: "start" });

            writer.write({ type: "text-start", id: textId });
            writer.write({
              type: "text-delta",
              id: textId,
              delta: analysisText,
            });
            writer.write({ type: "text-end", id: textId });
            writer.write({ type: "finish" });
          },
        });

        return createUIMessageStreamResponse({ stream });
      } catch (err) {
        console.error("File analysis failed:", err);
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = "file-analysis-error";
            writer.write({ type: "start" });
            writer.write({ type: "text-start", id: textId });
            writer.write({
              type: "text-delta",
              id: textId,
              delta: `Failed to analyze "${fileName}": ${String(err)}`,
            });
            writer.write({ type: "text-end", id: textId });
            writer.write({ type: "finish" });
          },
        });
        return createUIMessageStreamResponse({ stream });
      }
    }

    // otherwise continue to LLM flow below
  }

  // --- Normal streaming LLM flow ---
  const result = streamText({
    model: MODEL,
    system: SYSTEM_PROMPT,
    messages: convertToModelMessages(messages),
    tools: {
      webSearch,
      vectorDatabaseSearch,
    },
    stopWhen: stepCountIs(10),
    providerOptions: {
      openai: {
        reasoningSummary: "auto",
        reasoningEffort: "low",
        parallelToolCalls: false,
      },
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
