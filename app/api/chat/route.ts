import { streamText, UIMessage, convertToModelMessages, stepCountIs, createUIMessageStream, createUIMessageStreamResponse } from 'ai';
import { MODEL } from '@/config';
import { SYSTEM_PROMPT } from '@/prompts';
import { isContentFlagged } from '@/lib/moderation';
import { webSearch } from './tools/web-search';
import { vectorDatabaseSearch } from './tools/search-vector-database';

import pdfParse from 'pdf-parse';

export const maxDuration = 30;

function hasTextPart(p: unknown): p is { text: string } {
  return Boolean(p && typeof (p as any).text === 'string');
}

function extractTextFromParts(maybeParts: unknown): string {
  if (!Array.isArray(maybeParts)) return '';
  return maybeParts
    .filter((p) => (p as any).type === 'text' && hasTextPart(p))
    .map((p) => (p as any).text)
    .join('');
}

/* -------------------- Helpers: PDF / image / text analysis -------------------- */

async function analyzePDFBuffer(buf: Buffer, filename: string) {
  try {
    // Extract text from PDF
    const data = await pdfParse(buf);
    const fullText = (data && data.text) ? String(data.text).trim() : '';

    if (!fullText) {
      return `Could not extract text from "${filename}". The PDF may be a scanned image; try using "Run OCR" instead.`;
    }

    // If text not too large, summarize in one pass; otherwise chunk and summarize.
    const CHUNK_CHARS = 3000; // adjust as needed
    if (fullText.length <= CHUNK_CHARS) {
      // single-call summarization
      const prompt = `You are an assistant. Summarize the following PDF contents into:
1) a 3-line executive summary,
2) the main headings / sections,
3) 5 key takeaways.
Return a JSON object with keys: executive_summary, sections, key_takeaways.

Text:
${fullText}
`;
      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || MODEL || 'gpt-4o-mini',
          input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
          max_output_tokens: 1000,
          temperature: 0,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('OpenAI PDF error:', resp.status, errText);
        return `OpenAI error while analyzing "${filename}": ${errText}`;
      }
      const j = await resp.json();
      // try to extract text from response
      if (j?.output_text) return `OpenAI analysis for "${filename}":\n\n${j.output_text}`;
      if (j?.output?.[0]?.content) {
        return `OpenAI analysis for "${filename}":\n\n` + j.output[0].content.map((c: any) => c.text || c.description || '').filter(Boolean).join('\n');
      }
      return `OpenAI analysis for "${filename}":\n\n${JSON.stringify(j)}`;
    }

    // chunk and summarize each chunk
    const chunks: string[] = [];
    for (let i = 0; i < fullText.length; i += CHUNK_CHARS) {
      chunks.push(fullText.slice(i, i + CHUNK_CHARS));
    }

    const chunkSummaries: string[] = [];
    for (const [idx, chunk] of chunks.entries()) {
      const prompt = `Summarize this chunk of a PDF into 4 bullet points and a 1-line summary. Indicate "chunk ${idx+1}/${chunks.length}" at the top.

Chunk text:
${chunk}
`;
      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || MODEL || 'gpt-4o-mini',
          input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
          max_output_tokens: 800,
          temperature: 0,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error('OpenAI chunk error:', resp.status, errText);
        chunkSummaries.push(`(Chunk ${idx + 1} summary failed: ${errText})`);
        continue;
      }

      const j = await resp.json();
      let summaryText = j?.output_text || (j?.output?.[0]?.content?.map((c: any) => c.text || '')?.join('\n')) || JSON.stringify(j);
      chunkSummaries.push(`--- chunk ${idx + 1} ---\n${summaryText}`);
    }

    // Combine chunk summaries and create a final summary
    const combined = chunkSummaries.join('\n\n');
    const finalPrompt = `You are given summaries from chunks of a PDF. Combine and produce:
1) a 3-line executive summary,
2) a list of main sections/headings found,
3) five key takeaways.
Input:
${combined}
Return the answer as plain text.`;

    const finalResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || MODEL || 'gpt-4o-mini',
        input: [{ role: 'user', content: [{ type: 'input_text', text: finalPrompt }] }],
        max_output_tokens: 1000,
        temperature: 0,
      }),
    });

    if (!finalResp.ok) {
      const errText = await finalResp.text();
      console.error('OpenAI final summarize error:', finalResp.status, errText);
      return `OpenAI error while summarizing "${filename}": ${errText}`;
    }
    const fj = await finalResp.json();
    if (fj?.output_text) return `OpenAI analysis for "${filename}":\n\n${fj.output_text}`;
    if (fj?.output?.[0]?.content) {
      return `OpenAI analysis for "${filename}":\n\n` + fj.output[0].content.map((c: any) => c.text || c.description || '').filter(Boolean).join('\n');
    }
    return `OpenAI analysis for "${filename}":\n\n${JSON.stringify(fj)}`;
  } catch (err) {
    console.error('PDF analysis failed:', err);
    return `Failed to analyze "${filename}": ${String(err)}`;
  }
}

async function analyzeImageBuffer(buf: Buffer, filename: string, mimeType: string) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    return `Cannot analyze "${filename}" because OpenAI credentials are missing.`;
  }

  try {
    const base64 = buf.toString('base64');

    const promptText = `Extract all text (OCR) from the image. Then give a 2-line summary. Return JSON with keys: ocr_text, summary.`;

    const payload = {
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini-vision',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: promptText },
            { type: 'input_image', image: base64 }
          ]
        }
      ],
      max_output_tokens: 800,
      temperature: 0
    };

    const resp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('OpenAI image error:', resp.status, errText);
      return `OpenAI error while analyzing "${filename}": ${errText}`;
    }

    const j = await resp.json();

    let combinedText = '';

    if (j?.output?.[0]?.content) {
      combinedText = j.output[0].content
        .map((c: any) => c.text || c.description || '')
        .filter(Boolean)
        .join('\n');
    }

    if (!combinedText) {
      combinedText = j.output_text || JSON.stringify(j);
    }

    return `OpenAI image OCR for "${filename}":\n\n${combinedText}`;
  } catch (err) {
    console.error('Vision analysis failed:', err);
    return `Failed to analyze "${filename}": ${String(err)}`;
  }
}

/* -------------------- Main Route -------------------- */

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const latestUserMessage = messages.filter((msg) => msg.role === 'user').pop();

  if (latestUserMessage) {
    const textParts = extractTextFromParts((latestUserMessage as any).parts);

    if (textParts) {
      const moderationResult = await isContentFlagged(textParts);

      if (moderationResult.flagged) {
        const stream = createUIMessageStream({
          execute({ writer }) {
            const textId = 'moderation-denial-text';
            writer.write({ type: 'start' });
            writer.write({ type: 'text-start', id: textId });
            writer.write({
              type: 'text-delta',
              id: textId,
              delta:
                moderationResult.denialMessage ||
                "Your message violates our guidelines. I can't answer that.",
            });
            writer.write({ type: 'text-end', id: textId });
            writer.write({ type: 'finish' });
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
    const fileName = meta.fileName || 'uploaded-file';
    const mime = meta.fileType || 'unknown';
    const sizeKB = meta.fileSize ? Math.round(meta.fileSize / 1024) : 'unknown';

    // ack logic (same as before)
    const ackExistsAfter = messages.slice(fileMessageIndex + 1).some((m) => {
      if (m.role !== 'assistant' || !Array.isArray((m as any).parts)) return false;
      const parts = (m as any).parts;
      return parts.some((part: unknown) => hasTextPart(part) && part.text.includes(`Received "${fileName}"`));
    });

    if (!ackExistsAfter) {
      const userAfter = messages.slice(fileMessageIndex + 1).filter((m) => m.role === 'user');
      const latestUserAfter = userAfter.length ? userAfter[userAfter.length - 1] : null;
      const latestUserText = latestUserAfter ? extractTextFromParts((latestUserAfter as any).parts) : '';

      const wantsAnalyzeNow = /analyz|analyze|analysis|\bocr\b|\b(3)\b/i.test(latestUserText);

      if (!wantsAnalyzeNow && !latestUserAfter) {
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
    }

    // find latest user message after file message
    const userMessagesAfter = messages.slice(fileMessageIndex + 1).filter((m) => m.role === 'user');
    const latestUser = userMessagesAfter.length ? userMessagesAfter[userMessagesAfter.length - 1] : null;
    const latestUserText = latestUser ? extractTextFromParts((latestUser as any).parts) : '';
    const wantsAnalyze = /analyz|analyze|analysis|\bocr\b|\b(3)\b/i.test(latestUserText);

    if (wantsAnalyze && meta.fileContent) {
      // decode base64 to buffer:
      const base64WithPrefix = meta.fileContent as string;
      const base64 = base64WithPrefix.includes(',') ? base64WithPrefix.split(',')[1] : base64WithPrefix;
      const buffer = Buffer.from(base64, 'base64');

      // Branch by MIME
      const mimeLC = mime.toLowerCase();
      let analysisText = '';

      if (mimeLC === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
        // PDF flow
        analysisText = await analyzePDFBuffer(buffer, fileName);
      } else if (mimeLC.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp'].some(ext => fileName.toLowerCase().endsWith(ext))) {
        // Image flow
        analysisText = await analyzeImageBuffer(buffer, fileName, mime);
      } else if (mimeLC === 'text/plain' || fileName.toLowerCase().endsWith('.txt') || mimeLC === 'text/csv') {
        // plain text / csv
        const text = buffer.toString('utf8');
        const prompt = `Summarize the following document in 3 lines and list 5 key points:\n\n${text}`;
        const resp = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || MODEL || 'gpt-4o-mini',
            input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
            max_output_tokens: 800,
            temperature: 0,
          }),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          console.error('OpenAI text error:', resp.status, errText);
          analysisText = `OpenAI error while analyzing "${fileName}": ${errText}`;
        } else {
          const j = await resp.json();
          analysisText = j?.output_text || (j?.output?.[0]?.content?.map((c: any) => c.text || '')?.join('\n')) || JSON.stringify(j);
        }
      } else {
        // fallback: treat as binary and try image OCR, or return message
        analysisText = `I don't have a direct extractor for files of type ${mime}. If this is a PDF use the PDF channel; otherwise you can paste the text or convert to txt.`;
      }

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
