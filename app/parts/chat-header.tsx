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

export function ChatHeader() {
  return (
    <div className="w-full flex items-center justify-center px-4 py-3 border-b bg-[#e1e8f7]">
      {/* CENTERED LOGO + NAME */}
      <div className="flex items-center gap-2">
        <Image
          src="/logo.png"
          alt="Alchemista Logo"
          width={40}
          height={40}
          className="rounded-full"
        />
        <span className="text-xl font-semibold">Alchemista</span>
      </div>
    </div>
  );
}
