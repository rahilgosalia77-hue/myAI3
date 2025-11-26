import React from "react";
import { UIMessage } from "ai";

export function UserMessage({ message }: { message: UIMessage }) {
  return (
    <div className="w-full flex justify-end px-3 my-2">
      <div className="bg-[#0A3D91] text-white border border-[#0A3D91] rounded-2xl px-4 py-2 shadow-sm max-w-[80%] break-words">
        {message.parts?.map((p, i) => (
          <div key={i} className="whitespace-pre-wrap">
            {p.text}
          </div>
        ))}
      </div>
    </div>
  );
}
