import {
  Box,
  Flex,
  HStack,
  IconButton,
  Image,
  Spinner,
  Text,
  Textarea,
  useColorModeValue,
  useToast,
} from "@chakra-ui/react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuTrash2 } from "react-icons/lu";
import MarkdownContainer from "@/components/common/markdown-container";
import { MiuChatLogoTitle } from "@/components/logo-title";
import { useLauncherConfig } from "@/contexts/config";
import {
  FunctionCallProvider,
  useFunctionCall,
} from "@/contexts/function-call-context";
import { useGlobalData } from "@/contexts/global-data";
import { useSharedModals } from "@/contexts/shared-modal";
import { ChatMessage } from "@/models/intelligence";
import { NewsPostRequest } from "@/models/news-post";
import { getChatSystemPrompt } from "@/prompts";
import { ConfigService } from "@/services/config";
import { DiscoverService } from "@/services/discover";
import { InstanceService } from "@/services/instance";
import { IntelligenceService } from "@/services/intelligence";
import { FunctionCallMatch, findFunctionCalls } from "@/utils/function-call";
import { base64ImgSrc, formatPrintable } from "@/utils/string";

const AGENT_AVATAR_SRC = "/images/agent/miuxi_px_avatar.png";

const AgentChatContent: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { config } = useLauncherConfig();
  const { getPlayerList, selectedPlayer } = useGlobalData();

  // Initialize with system prompt
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      role: "system",
      content: getChatSystemPrompt(i18n.language),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const { openSharedModal } = useSharedModals();
  const { getCallState, setCallState } = useFunctionCall();

  useEffect(() => {
    getPlayerList(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    if (!config.intelligence.enabled) {
      // TODO: toast error or show modal
      return;
    }

    const userMsg: ChatMessage = { role: "user", content: input };
    // Include current conversation history plus the new message
    const newMessages = [...messages, userMsg];

    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    // Initial empty assistant message placeholder
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    let currentResponse = "";

    try {
      // System prompt is already in messages[0]
      await IntelligenceService.fetchLLMChatResponse(newMessages, (chunk) => {
        currentResponse += chunk;
        setMessages((prev) => {
          const updated = [...prev];
          // Update the last message (which is the assistant's)
          if (updated.length > 0) {
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: currentResponse,
            };
          }
          return updated;
        });
      });
    } catch (error) {
      console.error(error);
      setMessages((prev) => {
        const updated = [...prev];
        if (updated.length > 0) {
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content:
              currentResponse +
              "\n\n**Error:** An error occurred while fetching the response.",
          };
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const executeFunctionCall = async (
    name: string,
    params: Record<string, any>
  ) => {
    switch (name) {
      case "retrieve_instance_list":
        return await InstanceService.retrieveInstanceList();
      case "retrieve_instance_game_config":
        return await InstanceService.retrieveInstanceGameConfig(params.id);
      case "retrieve_instance_world_list":
        return await InstanceService.retrieveWorldList(params.id);
      case "retrieve_instance_world_details":
        return await InstanceService.retrieveWorldDetails(
          params.instanceId,
          params.worldName
        );
      case "retrieve_instance_game_server_list":
        return await InstanceService.retrieveGameServerList(params.id, true);
      case "retrieve_instance_local_mod_list":
        return await InstanceService.retrieveLocalModList(params.id);
      case "retrieve_instance_resource_pack_list":
        return await InstanceService.retrieveResourcePackList(params.id);
      case "retrieve_instance_server_resource_pack_list":
        return await InstanceService.retrieveServerResourcePackList(params.id);
      case "retrieve_instance_schematic_list":
        return await InstanceService.retrieveSchematicList(params.id);
      case "retrieve_instance_shader_pack_list":
        return await InstanceService.retrieveShaderPackList(params.id);
      case "launch_instance":
        let instance_list_response =
          await InstanceService.retrieveInstanceList();
        if (instance_list_response.status !== "success") {
          return {
            message: t("AgentChatPage.functionCall.launchInstance.fail"),
          };
        }
        let instance = instance_list_response.data.find(
          (instance) => instance.id === params.id
        );
        if (!instance) {
          return {
            message: t("AgentChatPage.functionCall.launchInstance.fail"),
          };
        } else {
          openSharedModal("launch", {
            instanceId: params.id,
          });
          return {
            message: t("AgentChatPage.functionCall.launchInstance.success"),
          };
        }
      case "retrieve_launcher_config":
        return config;
      case "retrieve_java_info":
        return await ConfigService.retrieveJavaList();
      case "fetch_news":
        const sources: NewsPostRequest[] = config.discoverSourceEndpoints.map(
          (url) => ({
            url,
            cursor: null,
          })
        );
        return await DiscoverService.fetchNewsPostSummaries(sources);
      default:
        return `Unknown function: ${name}`;
    }
  };

  const handleFunctionCall = React.useCallback(
    async (param: {
      name: string;
      params: Record<string, any>;
      callId?: number;
    }) => {
      const { name, params, callId } = param;

      // If callId is present, check if already executed/executing
      if (callId) {
        const state = getCallState(callId);
        if (state.isExecuting || state.result || state.error) {
          return;
        }
        setCallState(callId, {
          isExecuting: true,
          result: null,
          error: null,
        });
      }

      let result = "";
      try {
        result = formatPrintable(await executeFunctionCall(name, params));
        if (callId) {
          setCallState(callId, {
            isExecuting: false,
            result: result,
            error: null,
          });
        }
      } catch (e: any) {
        result = `Error: ${e.message || "Unknown error"}`;
        if (callId) {
          setCallState(callId, {
            isExecuting: false,
            result: null,
            error: result,
          });
        }
      }

      const systemMsg = { role: "system", content: result } as ChatMessage;

      // Use functional update to avoid overwriting concurrent messages
      setMessages((prev) => [...prev, systemMsg]);
      setIsLoading(true);

      // Add a placeholder message for the assistant's response
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const newHistory = [...messagesRef.current, systemMsg];

      try {
        let currentResponse = "";

        // Fetch response based on new history which includes the system result
        await IntelligenceService.fetchLLMChatResponse(newHistory, (chunk) => {
          currentResponse += chunk;
          setMessages((prev) => {
            const updated = [...prev];
            // Update the last message (which is the new assistant message)
            if (updated.length > 0) {
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: currentResponse,
              };
            }
            return updated;
          });
        });
      } catch (e) {
        console.error(e);
        toast({ title: "Error fetching response", status: "error" });
        setMessages((prev) => {
          const updated = [...prev];
          if (
            updated.length > 0 &&
            updated[updated.length - 1].content === ""
          ) {
            updated[updated.length - 1].content =
              "**Error:** Execution failed.";
          }
          return updated;
        });
      } finally {
        setIsLoading(false);
      }
      return result;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [i18n.language, toast, getCallState, setCallState]
  );

  // Auto-execute function calls when response is finished
  useEffect(() => {
    if (isLoading || messages.length === 0) return;
    const lastMsgIndex = messages.length - 1;
    const lastMsg = messages[lastMsgIndex];

    if (lastMsg.role === "assistant") {
      const matches = findFunctionCalls(lastMsg.content);
      const validMatches = matches.filter(
        (m) => m.type === "success"
      ) as FunctionCallMatch[];

      if (validMatches.length > 0) {
        const lastMatch = validMatches[validMatches.length - 1];
        // Check context if already executed
        const state = getCallState(lastMsgIndex);
        if (!state.result && !state.error && !state.isExecuting) {
          handleFunctionCall({
            name: lastMatch.name,
            params: lastMatch.params,
            callId: lastMsgIndex,
          });
        }
      }
    }
  }, [isLoading, messages, handleFunctionCall, getCallState]);

  const bg = useColorModeValue("gray.50", "gray.900");
  const msgBgUser = useColorModeValue("blue.500", "blue.600");
  const msgBgBot = "transparent";
  const borderColor = useColorModeValue("gray.200", "gray.700");

  let filteredMessages = messages.filter(
    (msg) => msg.role !== "system" && msg.content.trim()
  );

  return (
    <Flex direction="column" h="100vh" bg={bg}>
      {/* Header */}
      <Flex
        px={4}
        py={3}
        borderBottomWidth={1}
        borderColor={borderColor}
        align="center"
        justify="space-between"
        bg={useColorModeValue("white", "gray.800")}
      >
        <HStack>
          <MiuChatLogoTitle />
        </HStack>
        <IconButton
          icon={<LuTrash2 />}
          aria-label="clear"
          size="sm"
          variant="ghost"
          onClick={() =>
            setMessages([
              { role: "system", content: getChatSystemPrompt(i18n.language) },
            ])
          }
        />
      </Flex>

      {/* Messages */}
      <Flex flex={1} overflowY="auto" direction="column" p={4} gap={4}>
        {filteredMessages.length === 0 && (
          <Flex
            direction="column"
            align="center"
            justify="center"
            h="100%"
            color="gray.500"
          >
            <Image
              boxSize="48px"
              objectFit="cover"
              src={AGENT_AVATAR_SRC}
              alt="agent"
              mb={4}
            />
            <Text>{t("AgentChatPage.description")}</Text>
          </Flex>
        )}
        {filteredMessages.map((msg, i) => {
          const originalIndex = messages.indexOf(msg);

          return (
            <Flex
              key={i}
              direction={msg.role === "user" ? "row-reverse" : "row"}
              gap={3}
              width="100%"
            >
              {(msg.role !== "user" ||
                (selectedPlayer && selectedPlayer.avatar)) &&
                (i > 0 && filteredMessages[i - 1].role === msg.role ? (
                  <Box boxSize="32px" />
                ) : (
                  <Image
                    boxSize="32px"
                    objectFit="cover"
                    src={
                      msg.role === "user"
                        ? base64ImgSrc(selectedPlayer?.avatar!)
                        : AGENT_AVATAR_SRC
                    }
                    alt={msg.role}
                  />
                ))}
              <Box
                bg={msg.role === "user" ? msgBgUser : msgBgBot}
                color={msg.role === "user" ? "white" : undefined}
                p={2}
                borderRadius="lg"
                maxW={msg.role === "user" ? "80%" : undefined}
                w={msg.role === "user" ? undefined : "80%"}
                position="relative"
              >
                <MarkdownContainer messageId={originalIndex}>
                  {msg.content}
                </MarkdownContainer>
              </Box>
            </Flex>
          );
        })}
        {isLoading &&
          messages.length > 0 &&
          messages[messages.length - 1].content === "" && (
            <Flex direction="row" gap={3}>
              {filteredMessages.length > 0 &&
              filteredMessages[filteredMessages.length - 1].role ===
                "assistant" ? (
                <Box boxSize="32px" />
              ) : (
                <Image
                  boxSize="32px"
                  objectFit="cover"
                  src={AGENT_AVATAR_SRC}
                  alt="agent"
                />
              )}
              <Box bg={msgBgBot} p={2} borderRadius="lg">
                <Spinner size="sm" speed="0.8s" />
              </Box>
            </Flex>
          )}
        <div ref={messagesEndRef} />
      </Flex>

      {/* Input */}
      <Box
        p={4}
        bg={useColorModeValue("white", "gray.800")}
        borderTopWidth={1}
        borderColor={borderColor}
      >
        <HStack>
          <Textarea
            placeholder={t("AgentChatPage.placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            borderRadius="xl"
          />
        </HStack>
      </Box>
    </Flex>
  );
};

const AgentChatPage: React.FC = () => {
  return (
    <FunctionCallProvider>
      <AgentChatContent />
    </FunctionCallProvider>
  );
};

export default AgentChatPage;
