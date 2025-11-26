<Input
  {...field}
  id="chat-form-message"
  className="
    h-12
    pr-20 pl-5
    w-full
    rounded-[20px]
    bg-[#e1e8f7]
    text-black
    placeholder-black/40
    border border-[#0A3D91]
    focus:outline-none
    focus:ring-2 focus:ring-blue-300/40
    shadow-sm
  "
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

{/* send button (ready / error) */}
{(status == "ready" || status == "error") && (
  <Button
    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-[#0A3D91] text-white hover:bg-[#082b6f] shadow"
    type="submit"
    disabled={!field.value.trim()}
    size="icon"
  >
    <ArrowUp className="size-4" />
  </Button>
)}

{/* stop button (streaming / submitted) */}
{(status == "streaming" || status == "submitted") && (
  <Button
    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-[#D4D4D4] text-black hover:bg-[#c8c8c8] shadow"
    size="icon"
    onClick={() => {
      stop();
    }}
  >
    <Square className="size-4" />
  </Button>
)}
