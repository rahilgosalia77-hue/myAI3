import { UIMessage, ToolCallPart, ToolResultPart } from "ai";
import { Response } from "@/components/ai-elements/response";
import { ReasoningPart } from "./reasoning-part";
import { ToolCall, ToolResult } from "./tool-call";

export function AssistantMessage({
  message,
  status,
  isLastMessage,
  durations,
  onDurationChange,
}: {
  message: UIMessage;
  status?: string;
  isLastMessage?: boolean;
  durations?: Record<string, number>;
  onDurationChange?: (key: string, duration: number) => void;
}) {
  return (
    <div className="w-full">
      {/* Row: avatar on left, message content on right */}
      <div className="flex items-start gap-4 px-3 my-3">
        {/* Avatar / Logo */}
        <img
          src="/logo.png"
          alt="Alchemista logo"
          className="w-10 h-10 rounded-full object-cover shadow-sm flex-shrink-0"
        />

        {/* Message content (parts) */}
        <div className="flex-1 text-sm flex flex-col gap-4">
          {message.parts.map((part, i) => {
            const isStreaming =
              status === "streaming" && isLastMessage && i === message.parts.length - 1;
            const durationKey = `${message.id}-${i}`;
            const duration = durations?.[durationKey];

            if (part.type === "text") {
              return (
                <div
                  key={`${message.id}-${i}`}
                  className="bg-white text-black px-4 py-3 rounded-xl border border-gray-300 shadow-sm whitespace-pre-wrap"
                >
                  <Response>{part.text}</Response>
                </div>
              );
            } else if (part.type === "reasoning") {
              return (
                <ReasoningPart
                  key={`${message.id}-${i}`}
                  part={part}
                  isStreaming={isStreaming}
                  duration={duration}
                  onDurationChange={
                    onDurationChange ? (d) => onDurationChange(durationKey, d) : undefined
                  }
                />
              );
            } else if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
              if ("state" in part && part.state === "output-available") {
                return <ToolResult key={`${message.id}-${i}`} part={part as unknown as ToolResultPart} />;
              } else {
                return <ToolCall key={`${message.id}-${i}`} part={part as unknown as ToolCallPart} />;
              }
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}
