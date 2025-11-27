"use client";

import React from "react";
import { cn } from "@/lib/utils";

export function ChatHeaderBlock({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("gap-2 flex flex-1", className)}>{children}</div>;
}

/**
 * ChatHeader: a simple client header wrapper.
 * Use this inside client pages/components only.
 */
export function ChatHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full flex items-center justify-between px-4 py-3 border-b bg-[#e1e8f7]">
      {children}
    </div>
  );
}
