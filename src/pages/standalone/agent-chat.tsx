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
} from "@chakra-ui/react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuTrash2 } from "react-icons/lu";
import MarkdownContainer from "@/components/common/markdown-container";
import { MiuChatLogoTitle } from "@/components/logo-title";
import { useLauncherConfig } from "@/contexts/config";
import { useGlobalData } from "@/contexts/global-data";
import { Player } from "@/models/account";
import { ChatMessage } from "@/models/intelligence";
import { IntelligenceService } from "@/services/intelligence";
import { base64ImgSrc } from "@/utils/string";

const AGENT_AVATAR_SRC = "/images/agent/miuxi_px_avatar.png";
const AgentChatPage: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useLauncherConfig();
  const { getPlayerList } = useGlobalData();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player>();

  useEffect(() => {
    const playerList = getPlayerList(true);
    const selectedPlayerId = config.states.shared.selectedPlayerId;
    setSelectedPlayer(
      playerList?.find((player) => player.id === selectedPlayerId)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.states.shared.selectedPlayerId]);

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
      const systemMsg: ChatMessage = {
        role: "system",
        content: t("AgentChatPage.systemPrompt"),
      };
      await IntelligenceService.fetchLLMChatResponse(
        [systemMsg, ...newMessages],
        (chunk) => {
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
        }
      );
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

  const bg = useColorModeValue("gray.50", "gray.900");
  const msgBgUser = useColorModeValue("blue.500", "blue.600");
  const msgBgBot = useColorModeValue("white", "gray.700");
  const borderColor = useColorModeValue("gray.200", "gray.700");

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
          onClick={() => setMessages([])}
        />
      </Flex>

      {/* Messages */}
      <Flex flex={1} overflowY="auto" direction="column" p={4} gap={4}>
        {messages.length === 0 && (
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
        {messages.map((msg, i) => (
          <Flex
            key={i}
            direction={msg.role === "user" ? "row-reverse" : "row"}
            gap={3}
            width="100%"
          >
            {(msg.role !== "user" ||
              (selectedPlayer && selectedPlayer.avatar)) && (
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
            )}
            <Box
              bg={msg.role === "user" ? msgBgUser : msgBgBot}
              color={msg.role === "user" ? "white" : undefined}
              p={3}
              borderRadius="lg"
              maxW="80%"
              boxShadow="sm"
              position="relative"
            >
              <MarkdownContainer>{msg.content}</MarkdownContainer>
            </Box>
          </Flex>
        ))}
        {isLoading &&
          messages.length > 0 &&
          messages[messages.length - 1].content === "" && (
            <Flex direction="row" gap={3}>
              <Image
                boxSize="32px"
                objectFit="cover"
                src={AGENT_AVATAR_SRC}
                alt="agent"
              />
              <Box bg={msgBgBot} p={3} borderRadius="lg" boxShadow="sm">
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

export default AgentChatPage;
