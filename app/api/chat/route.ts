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

  // --- File upload detection / acknowledgement (parser-safe) ---
  let fileMessage: any | undefined = undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as any;
    if (m && m.metadata && m.metadata.fileContent) {
      fileMessage = m;
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

    // optional: decode file if you need to process it
    // const base64WithPrefix = meta.fileContent as string;
    // const base64 = base64WithPrefix.split(',')[1];
    // const buffer = Buffer.from(base64, 'base64');
    // ...process buffer (OCR, image analysis, save to cloud, etc.)

    const stream = createUIMessageStream({
      execute({ writer }) {
        const textId = 'file-received-text';
        writer.write({ type: 'start' });

        writer.write({
          type: 'text-start',
          id: textId,
        });

        writer.write({
          type: 'text-delta',
          id: textId,
          delta: `Received "${fileName}" (${sizeKB} KB, ${mime}). I can (1) summarize text, (2) run OCR, (3) analyze images, or (4) extract tables. What would you like me to do with this file?`,
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
