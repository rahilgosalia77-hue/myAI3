import Image from "next/image";
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

export function ChatHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full flex items-center justify-between px-4 py-3 border-b bg-[#e1e8f7]">
      {/* LEFT SIDE → Logo + Name */}
      <div className="flex items-center gap-3">
        <Image
          src="/logo.png"   // make sure logo.png is inside /public
          alt="Alchemista Logo"
          width={40}
          height={40}
          className="rounded-full border"
        />

        <span className="text-xl font-semibold text-gray-800">
          Alchemista
        </span>
      </div>

      {/* RIGHT SIDE CONTENT (e.g. new chat button) */}
      {children}
    </div>
  );
}
