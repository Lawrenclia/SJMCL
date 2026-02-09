import { Channel, invoke } from "@tauri-apps/api/core";
import { ChatMessage } from "@/models/intelligence";
import { InvokeResponse } from "@/models/response";
import { responseHandler } from "@/utils/response";

/**
 * Service class for managing intelligence services (e.g. LLM) and interactions.
 */
export class IntelligenceService {
  /**
   * CHECK the availability of the LLM service.
   * @param {string} baseUrl The base URL of the LLM service.
   * @param {string} apiKey The API key for authentication.
   * @return {Promise<InvokeResponse<string[]>>}
   */
  @responseHandler("intelligence")
  public static async retrieveLLMModels(
    baseUrl: string,
    apiKey: string
  ): Promise<InvokeResponse<string[]>> {
    return invoke("retrieve_llm_models", { baseUrl, apiKey });
  }

  /**
   * RETRIEVE LLM chat response for a given message.
   * @param {ChatMessage[]} messages The list of chat messages.
   * @param {(chunk: string) => void} [onChunk] Optional callback for streaming response chunks.
   * @return {Promise<InvokeResponse<string>>}
   */
  @responseHandler("intelligence")
  public static async fetchLLMChatResponse(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void
  ): Promise<InvokeResponse<string>> {
    if (onChunk) {
      const channel = new Channel<string>();
      channel.onmessage = onChunk;
      await invoke("fetch_llm_chat_response_stream", {
        messages,
        onEvent: channel,
      });
      return { status: "success", data: "", message: "Stream completed" };
    }
    return invoke("fetch_llm_chat_response", { messages });
  }
}
