"use client";

import { Paperclip } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useChat } from "@ai-sdk/react";

import { ArrowUp, Loader2, Plus, Square } from "lucide-react";
import { MessageWall } from "@/components/messages/message-wall";
import { ChatHeader } from "@/app/parts/chat-header";
import { ChatHeaderBlock } from "@/app/parts/chat-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UIMessage } from "ai";

import { useEffect, useState, useRef } from "react";
import { AI_NAME, CLEAR_CHAT_TEXT, OWNER_NAME, WELCOME_MESSAGE } from "@/config";
import Image from "next/image";
import Link from "next/link";

/// ⭐ CORRECT IMPORT — your QuickSidebar lives in app/QuickSidebar.tsx
import QuickSidebar from "@/app/QuickSidebar";


/* ------------------------------- validation ------------------------------ */

const formSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty.")
    .max(2000, "Message must be at most 2000 characters."),
});

const STORAGE_KEY = 'chat-messages';

type StorageData = {
  messages: UIMessage[];
  durations: Record<string, number>;
};


/* ------------------------------ local storage ----------------------------- */

const loadMessagesFromStorage = (): { messages: UIMessage[]; durations: Record<string, number> } => {
  if (typeof window === 'undefined') return { messages: [], durations: {} };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { messages: [], durations: {} };

    const parsed = JSON.parse(stored);
    return {
      messages: parsed.messages || [],
      durations: parsed.durations || {},
    };
  } catch (error) {
    console.error('Failed to load messages from localStorage:', error);
    return { messages: [], durations: {} };
  }
};

const saveMessagesToStorage = (messages: UIMessage[], durations: Record<string, number>) => {
  if (typeof window === 'undefined') return;
  try {
    const data: StorageData = { messages, durations };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Failed to save messages to localStorage:', error);
  }
};


/* --------------------------------- page ---------------------------------- */

export default function Chat() {
  const [isClient, setIsClient] = useState(false);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const welcomeMessageShownRef = useRef<boolean>(false);

  const stored = typeof window !== 'undefined' ? loadMessagesFromStorage() : { messages: [], durations: {} };
  const [initialMessages] = useState<UIMessage[]>(stored.messages);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    messages: initialMessages,
  });

  useEffect(() => {
    setIsClient(true);
    setDurations(stored.durations);
    setMessages(stored.messages);
  }, []);

  useEffect(() => {
    if (isClient) {
      saveMessagesToStorage(messages, durations);
    }
  }, [durations, messages, isClient]);


  const handleDurationChange = (key: string, duration: number) => {
    setDurations((prevDurations) => {
      const newDurations = { ...prevDurations };
      newDurations[key] = duration;
      return newDurations;
    });
  };


  /* --------------------------- welcome message --------------------------- */

  useEffect(() => {
    if (isClient && initialMessages.length === 0 && !welcomeMessageShownRef.current) {
      const welcomeMessage: UIMessage = {
        id: `welcome-${Date.now()}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: WELCOME_MESSAGE,
          },
        ],
      };
      setMessages([welcomeMessage]);
      saveMessagesToStorage([welcomeMessage], {});
      welcomeMessageShownRef.current = true;
    }
  }, [isClient, initialMessages.length, setMessages]);


  /* ------------------------------- form --------------------------------- */

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      message: "",
    },
  });

  function onSubmit(data: z.infer<typeof formSchema>) {
    sendMessage({ text: data.message });
    form.reset();
  }

  function clearChat() {
    const newMessages: UIMessage[] = [];
    const newDurations = {};
    setMessages(newMessages);
    setDurations(newDurations);
    saveMessagesToStorage(newMessages, newDurations);
    toast.success("Chat cleared");
  }


  /* ------------------------ Quick Action Handler ------------------------ */
  function handleQuickAction(text: string) {
    sendMessage({ text });
  }


  /* ----------------------------- UI Layout ------------------------------ */

  return (
    <div className="flex h-screen font-sans dark:bg-black">

      {/* ⭐ LEFT SIDEBAR */}
      <QuickSidebar onAction={handleQuickAction} />

      {/* ⭐ MAIN CHAT AREA (shifted right by ml-28 so sidebar doesn't overlap) */}
      <main className="flex-1 ml-28 relative">

        {/* Header */}
        <div className="fixed top-0 left-28 right-0 z-50 bg-linear-to-b from-background via-background/50 to-transparent dark:bg-black pb-16">
          <ChatHeader>
            <ChatHeaderBlock />
            <ChatHeaderBlock className="justify-center items-center">
              <Avatar className="size-8 ring-1 ring-primary">
                <AvatarImage src="/logo.png" />
                <AvatarFallback>
                  <Image src="/logo.png" alt="Logo" width={36} height={36} />
                </AvatarFallback>
              </Avatar>
              <p className="tracking-tight">Chat with {AI_NAME}</p>
            </ChatHeaderBlock>
            <ChatHeaderBlock className="justify-end">
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={clearChat}
              >
                <Plus className="size-4" />
                {CLEAR_CHAT_TEXT}
              </Button>
            </ChatHeaderBlock>
          </ChatHeader>
        </div>

        {/* Messages */}
        <div className="h-screen overflow-y-auto px-5 py-4 w-full pt-[88px] pb-[150px]">
          <div className="flex flex-col items-center justify-end min-h-full">
            {isClient ? (
              <>
                <MessageWall
                  messages={messages}
                  status={status}
                  durations={durations}
                  onDurationChange={handleDurationChange}
                />

                {status === "submitted" && (
                  <div className="flex justify-start max-w-3xl w-full">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                )}

              </>
            ) : (
              <div className="flex justify-center max-w-2xl w-full">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </div>

        {/* Chat Input Bar */}
        <div className="fixed bottom-0 left-28 right-0 z-50 bg-linear-to-t from-background via-background/50 to-transparent dark:bg-black pt-13">
          <div className="w-full px-5 pt-5 pb-1 items-center flex justify-center relative">
            
            <div className="max-w-5xl w-full">
              <form id="chat-form" onSubmit={form.handleSubmit(onSubmit)}>
                <FieldGroup>
                  <Controller
                    name="message"
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor="chat-form-message" className="sr-only">
                          Message
                        </FieldLabel>

                        <div className="relative h-13">

                          {/* File Upload */}
                          <label
                            htmlFor="file-upload"
                            className="absolute left-4 top-1/2 -translate-y-1/2 cursor-pointer p-1 rounded-full hover:bg-gray-200/30 z-10"
                            title="Upload a file"
                          >
                            <Paperclip className="w-5 h-5 text-gray-600" />
                          </label>

                          <input
                            id="file-upload"
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.xlsx"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;

                              if (file.size > 10 * 1024 * 1024) {
                                toast.error("File too large (max 10MB)");
                                e.target.value = "";
                                return;
                              }

                              const reader = new FileReader();
                              reader.onload = () => {
                                const base64 = reader.result as string;

                                sendMessage({
                                  text: `I uploaded a file named "${file.name}". Please analyze it.`,
                                  metadata: {
                                    fileName: file.name,
                                    fileType: file.type,
                                    fileSize: file.size,
                                    fileContent: base64,
                                  },
                                });

                                toast.success(`Uploaded ${file.name}`);
                                e.target.value = "";
                              };

                              reader.onerror = () => {
                                toast.error("Failed to read file.");
                                e.target.value = "";
                              };

                              reader.readAsDataURL(file);
                            }}
                          />

                          {/* Text Input */}
                          <Input
                            {...field}
                            id="chat-form-message"
                            className="h-13 pr-15 pl-14
                              rounded-[20px]
                              bg-[#e1e8f7]
                              text-black
                              placeholder-white/60
                              border border-[#0A3D91]
                              focus:outline-none
                              focus:ring-2 focus:ring-blue-300/40
                              shadow-sm"
                            placeholder="Type your message here..."
                            disabled={status === "streaming"}
                            aria-invalid={fieldState.invalid}
                            autoComplete="off"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                form.handleSubmit(onSubmit)();
                              }
                            }}
                          />

                          {/* Send / Stop Buttons */}
                          {(status == "ready" || status == "error") && (
                            <Button
                              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-[#0A3D91] text-white hover:bg-[#082b6f]"
                              type="submit"
                              disabled={!field.value.trim()}
                              size="icon"
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                          )}

                          {(status == "streaming" || status == "submitted") && (
                            <Button
                              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full"
                              size="icon"
                              onClick={() => stop()}
                            >
                              <Square className="size-4" />
                            </Button>
                          )}
                        </div>
                      </Field>
                    )}
                  />
                </FieldGroup>
              </form>
            </div>
          </div>

          <div className="w-full px-5 py-3 flex justify-center text-xs text-muted-foreground">
            © {new Date().getFullYear()} {OWNER_NAME}&nbsp;
            <Link href="/terms" className="underline">Terms of Use</Link>&nbsp;
            Powered by&nbsp;
            <Link href="https://ringel.ai/" className="underline">Ringel.AI</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
