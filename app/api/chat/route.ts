import { streamText, UIMessage, convertToModelMessages, stepCountIs, createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { MODEL } from '@/config';
import { SYSTEM_PROMPT } from '@/prompts';
import { isContentFlagged } from '@/lib/moderation';
import { webSearch } from './tools/web-search';
import { vectorDatabaseSearch } from './tools/search-vector-database';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const latestUserMessage = messages.filter((msg) => msg.role === 'user').pop();

  if (latestUserMessage) {
    const textParts = latestUserMessage.parts
      .filter((part) => part.type === 'text')
      .map((part) => ('text' in part ? part.text : ''))
      .join('');

    if (textParts) {
      const moderationResult = await isContentFlagged(textParts);

      if (moderationResult.flagged) {
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = 'moderation-denial-text';

            writer.write({
              type: 'start',
            });

            writer.write({
              type: 'text-start',
              id: textId,
            });

            writer.write({
              type: 'text-delta',
              id: textId,
              delta:
                moderationResult.denialMessage ||
                "Your message violates our guidelines. I can't answer that.",
            });

            writer.write({
              type: 'text-end',
              id: textId,
            });

            writer.write({
              type: 'finish',
            });
          },
        });

        return createUIMessageStreamResponse({ stream });
      }
    }
  }

  // --- Improved file handling: acknowledge once, and run analysis if user requests it ---
// Find the most recent message that contains file metadata
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

  // 1) Check if an assistant acknowledgement for this file already exists *after* the file message
  const ackExistsAfter = messages.slice(fileMessageIndex + 1).some((m) => {
    return m.role === "assistant" && typeof m.parts?.[0]?.text === "string" && m.parts[0].text.includes(`Received "${fileName}"`);
  });
  if (ackExistsAfter) {
    // If already acknowledged, continue normal flow (do not re-acknowledge)
    // But we still want to check if there's a user command AFTER fileMessage asking to analyze.
  } else {
    // If not acknowledged yet and there's no immediate user command asking to analyze, return acknowledgement.
    // But first check: is there a user message AFTER the file asking for analysis? If yes, we'll analyze directly.
    // find latest user message after fileMessageIndex
    const userAfter = messages.slice(fileMessageIndex + 1).filter(m => m.role === "user");
    const latestUserAfter = userAfter.length ? userAfter[userAfter.length - 1] : null;
    const latestUserText = latestUserAfter
      ? latestUserAfter.parts?.filter((p:any) => p.type === "text").map((p:any)=> p.text).join("") || ""
      : "";

    const wantsAnalyzeNow = /analyz|analyze|analysis|\bocr\b|\b(3)\b/i.test(latestUserText);

    if (!wantsAnalyzeNow && !latestUserAfter) {
      // No follow-up user command — send single acknowledgement and return
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

    // If not acknowledged and there *is* a user command after uploading that requests analysis,
    // we should fall through and process below (so server will analyze).
    // If ackExistsAfter is false but latestUserAfter exists and wantsAnalyzeNow is true, fall through to analyze.
  }

  // 2) At this point: check again if there *is* a user request to ANALYZE the file that occurs after the fileMessage.
  // Find the latest user message after the file message index
  const userMessagesAfter = messages.slice(fileMessageIndex + 1).filter(m => m.role === "user");
  const latestUser = userMessagesAfter.length ? userMessagesAfter[userMessagesAfter.length - 1] : null;
  const latestUserText = latestUser
    ? latestUser.parts?.filter((p:any) => p.type === "text").map((p:any) => p.text).join("") || ""
    : "";

  const wantsAnalyze = /analyz|analyze|analysis|\bocr\b|\b(3)\b/i.test(latestUserText);

  if (wantsAnalyze && meta.fileContent) {
    // decode base64 to buffer:
    const base64WithPrefix = meta.fileContent as string;
    const base64 = base64WithPrefix.includes(",") ? base64WithPrefix.split(",")[1] : base64WithPrefix;
    const buffer = Buffer.from(base64, "base64");

    // ---- placeholder analysis function ----
    // Replace this with real image analysis (Vision API, OCR, etc)
    async function analyzeImageBuffer(buf: Buffer, filename: string, mimeType: string) {
      // Example placeholder result - replace with calls to your vision/OCR API
      return `I examined "${filename}". (Placeholder analysis) I can detect edges, count objects, or run OCR. Replace this with real vision/ocr results.`;
    }
    // ----------------------------------------

    const analysisText = await analyzeImageBuffer(buffer, fileName, mime);

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
  }

  // If nothing matched (no analyze command), and ack was already returned earlier, continue to normal LLM flow
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
        reasoningSummary: 'auto',
        reasoningEffort: 'low',
        parallelToolCalls: false,
      },
    },
  });

  return result.toUIMessageStreamResponse({
    sendReasoning: true,
  });
}
