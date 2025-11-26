import { streamText, UIMessage, convertToModelMessages, stepCountIs, createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { MODEL } from '@/config';
import { SYSTEM_PROMPT } from '@/prompts';
import { isContentFlagged } from '@/lib/moderation';
import { webSearch } from './tools/web-search';
import { vectorDatabaseSearch } from './tools/search-vector-database';

export const maxDuration = 30;

/**
 * Type-guard: detects parts that have a `text: string` field.
 * This safely narrows union members like "dynamic-tool" which don't have text.
 */
function hasTextPart(p: unknown): p is { text: string } {
  return Boolean(p && typeof (p as any).text === 'string');
}

/**
 * Helper: safely get concatenated text from a message's parts (only text parts).
 */
function extractTextFromParts(maybeParts: unknown): string {
  if (!Array.isArray(maybeParts)) return '';
  return maybeParts
    .filter((p) => (p as any).type === 'text' && hasTextPart(p))
    .map((p) => (p as any).text)
    .join('');
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // latest user message (if any)
  const latestUserMessage = messages.filter((msg) => msg.role === 'user').pop();

  if (latestUserMessage) {
    const textParts = extractTextFromParts((latestUserMessage as any).parts);

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
    const fileName = meta.fileName || 'uploaded-file';
    const mime = meta.fileType || 'unknown';
    const sizeKB = meta.fileSize ? Math.round(meta.fileSize / 1024) : 'unknown';

    // 1) Check if an assistant acknowledgement for this file already exists *after* the file message
    const ackExistsAfter = messages.slice(fileMessageIndex + 1).some((m) => {
      if (m.role !== 'assistant' || !Array.isArray((m as any).parts)) return false;
      const parts = (m as any).parts;
      return parts.some((part: unknown) => hasTextPart(part) && part.text.includes(`Received "${fileName}"`));
    });

    if (ackExistsAfter) {
      // If already acknowledged, continue normal flow (do not re-acknowledge)
      // But we still want to check if there's a user command AFTER fileMessage asking to analyze.
    } else {
      // If not acknowledged yet and there's no immediate user command asking to analyze, return acknowledgement.
      // But first check: is there a user message AFTER the file asking for analysis? If yes, we'll analyze directly.
      // find latest user message after fileMessageIndex
      const userAfter = messages.slice(fileMessageIndex + 1).filter((m) => m.role === 'user');
      const latestUserAfter = userAfter.length ? userAfter[userAfter.length - 1] : null;
      const latestUserText = latestUserAfter ? extractTextFromParts((latestUserAfter as any).parts) : '';

      const wantsAnalyzeNow = /analyz|analyze|analysis|\bocr\b|\b(3)\b/i.test(latestUserText);

      if (!wantsAnalyzeNow && !latestUserAfter) {
        // No follow-up user command — send single acknowledgement and return
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = 'file-received-text';
            writer.write({ type: 'start' });

            writer.write({ type: 'text-start', id: textId });
            writer.write({
              type: 'text-delta',
              id: textId,
              delta: `Received "${fileName}" (${sizeKB} KB, ${mime}). I can (1) summarize text, (2) run OCR, (3) analyze images, or (4) extract tables. What would you like me to do with this file?`,
            });
            writer.write({ type: 'text-end', id: textId });
            writer.write({ type: 'finish' });
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
    const userMessagesAfter = messages.slice(fileMessageIndex + 1).filter((m) => m.role === 'user');
    const latestUser = userMessagesAfter.length ? userMessagesAfter[userMessagesAfter.length - 1] : null;
    const latestUserText = latestUser ? extractTextFromParts((latestUser as any).parts) : '';

    const wantsAnalyze = /analyz|analyze|analysis|\bocr\b|\b(3)\b/i.test(latestUserText);

    if (wantsAnalyze && meta.fileContent) {
      // decode base64 to buffer:
      const base64WithPrefix = meta.fileContent as string;
      const base64 = base64WithPrefix.includes(',') ? base64WithPrefix.split(',')[1] : base64WithPrefix;
      const buffer = Buffer.from(base64, 'base64');

      // ---- placeholder analysis function ----
      // Replace this with real image analysis (Vision API, OCR, etc)
      async function analyzeImageBuffer(buf: Buffer, filename: string, mimeType: string) {
        // ---- OpenAI Vision analysis function ----
async function analyzeImageBuffer(buf: Buffer, filename: string, mimeType: string) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    return `Cannot analyze "${filename}" because OpenAI credentials are missing.`;
  }

  try {
    const base64 = buf.toString('base64');

    const promptText = `Extract all text (OCR) from the image. Then give a 2-line summary. Return JSON with keys: ocr_text, summary.`;

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini-vision',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: promptText },
              { type: 'input_image', image_base64: base64, mime_type: mimeType, filename }
            ]
          }
        ],
        max_output_tokens: 800,
        temperature: 0
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('OpenAI error:', resp.status, errText);
      return `OpenAI error while analyzing "${filename}": ${errText}`;
    }

    const j = await resp.json();

    let combinedText = '';

    // Try to read output from Responses API
    if (j?.output?.[0]?.content) {
      combinedText = j.output[0].content
        .map((c: any) => c.text || c.description || '')
        .filter(Boolean)
        .join('\n');
    }

    if (!combinedText) {
      combinedText = j.output_text || JSON.stringify(j);
    }

    return `OpenAI analysis for "${filename}":\n\n${combinedText}`;
  } catch (err) {
    console.error('Vision analysis failed:', err);
    return `Failed to analyze "${filename}": ${String(err)}`;
  }
}
// -----------------------------------------

      const analysisText = await analyzeImageBuffer(buffer, fileName, mime);

      const stream = createUIMessageStream({
        execute({ writer }) {
          const textId = 'file-analysis-text';
          writer.write({ type: 'start' });

          writer.write({ type: 'text-start', id: textId });
          writer.write({
            type: 'text-delta',
            id: textId,
            delta: analysisText,
          });
          writer.write({ type: 'text-end', id: textId });
          writer.write({ type: 'finish' });
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
