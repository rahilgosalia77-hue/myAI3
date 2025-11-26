import { UIMessage } from "ai";
import { Response } from "@/components/ai-elements/response";

export function UserMessage({ message }: { message: UIMessage }) {
    return (
        <div className="flex w-full">
      <div className="ml-auto max-w-[80%]">
        <div
          className="
            px-4 py-3
            rounded-2xl
            bg-[#0A3D91]        /* dark blue bubble */
            text-white         /* white message text */
            break-words
            whitespace-pre-wrap
            shadow-sm
          "">
                    {message.parts.map((part, i) => {
                        switch (part.type) {
                            case "text":
                                return <Response key={`${message.id}-${i}`}>{part.text}</Response>;
                        }
                    })}
                </div>
            </div>
        </div>
    )
}
