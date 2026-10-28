// Coalesce token-sized chunks so Markdown rendering leaves time for input/navigation.
export function createChatStream(onUpdate: (content: string) => void) {
  let content = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    append(chunk: string) {
      content += chunk;
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        onUpdate(content);
      }, 50);
    },
    finish() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      return content;
    },
  };
}
