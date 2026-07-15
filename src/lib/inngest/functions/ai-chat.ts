import { inngest } from "../client";
import { runChatEdit } from "@/lib/ai/chat-core";

type ChatEditEvent = {
  name: "ai/chat.edit";
  data: {
    userMessageId: string;
    variationId: string;
    requestId: string;
    message: string;
    pageIndex: number | null;
    attachmentPaths?: string[];
  };
};

/**
 * Inngest chat-edit (POSTER_ENGINE=inngest). The actual logic lives in
 * runChatEdit so the standalone worker (POSTER_ENGINE=server) shares it.
 */
export const aiChatEdit = inngest.createFunction(
  {
    id: "ai-chat-edit",
    retries: 1,
    triggers: [{ event: "ai/chat.edit" }],
  },
  async ({ event }: { event: { data: ChatEditEvent["data"] } }) => {
    const { variationId, message, pageIndex, attachmentPaths } = event.data;
    await runChatEdit({ variationId, message, pageIndex, attachmentPaths });
  },
);
