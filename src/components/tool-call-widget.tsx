import {
  Box,
  Button,
  Code,
  Collapse,
  HStack,
  Icon,
  Spinner,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import React, { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuBan,
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuCircleHelp,
  LuClock,
  LuX,
  LuZap,
} from "react-icons/lu";
import { useToolCall } from "@/contexts/tool-call";
import { ToolCallStatus } from "@/enums/tool-call";
import { parseToolCallStatus } from "@/utils/tool-call/parser";

export interface ToolCallParams {
  name: string;
  params: Record<string, any>;
  result?: string;
}

export const ToolCallWidget: React.FC<{
  data: ToolCallParams;
  callId?: string;
  onConfirmationAction?: (action: "confirm" | "cancel") => void;
}> = ({ data, callId, onConfirmationAction }) => {
  const { t } = useTranslation();
  const bgColor = useColorModeValue("purple.50", "purple.900");
  const borderColor = useColorModeValue("purple.200", "purple.700");
  const textColor = useColorModeValue("purple.800", "purple.100");
  const codeBgColor = useColorModeValue("whiteAlpha.500", "blackAlpha.400");
  const { getToolCallState } = useToolCall();

  const [isOpen, setIsOpen] = useState(false);
  const [isParamsOpen, setIsParamsOpen] = useState(false);
  const detailsId = useId();

  // Get state from context if callId is available
  const contextState = callId ? getToolCallState(callId) : null;

  // Fallback to data.result if no context state (e.g. historical messages)
  const result = contextState?.result ?? data.result;
  const error = contextState?.error;
  const isLoading = contextState?.isExecuting || false;
  const status = parseToolCallStatus(result);
  const hasError = !!error || status === ToolCallStatus.Error;
  const isCancelled = status === ToolCallStatus.Cancelled;

  const isPendingConfirmation = React.useMemo(() => {
    if (error || isLoading) return false;
    return parseToolCallStatus(result) === ToolCallStatus.PendingConfirmation;
  }, [result, error, isLoading]);

  useEffect(() => {
    if (isPendingConfirmation) setIsParamsOpen(true);
  }, [isPendingConfirmation]);

  useEffect(() => {
    if (hasError) setIsOpen(true);
  }, [hasError]);

  const statusLabel = isLoading
    ? t("AgentChatPage.toolCall.running")
    : isPendingConfirmation
      ? t("AgentChatPage.toolCall.pending")
      : hasError
        ? t("AgentChatPage.toolCall.error")
        : isCancelled
          ? t("AgentChatPage.toolCall.cancelled")
          : result != null
            ? t("AgentChatPage.toolCall.result")
            : t("AgentChatPage.toolCall.waiting");

  return (
    <Box
      w="full"
      minW={0}
      mt={2}
      p={3}
      borderRadius="xl"
      borderWidth="1px"
      bg={bgColor}
      borderColor={borderColor}
    >
      <HStack justify="space-between">
        <HStack minW={0}>
          <Icon as={LuZap} color={textColor} flexShrink={0} />
          <Text
            fontWeight="bold"
            fontSize="xs"
            color={textColor}
            overflowWrap="anywhere"
          >
            {t("AgentChatPage.toolCall.title")}: {data.name}
          </Text>
        </HStack>
        <Box flexShrink={0} aria-label={statusLabel} title={statusLabel}>
          {isLoading ? (
            <Spinner size="xs" />
          ) : (
            <Icon
              as={
                hasError
                  ? LuX
                  : isPendingConfirmation
                    ? LuCircleHelp
                    : isCancelled
                      ? LuBan
                      : result != null
                        ? LuCheck
                        : LuClock
              }
              color={
                hasError
                  ? "red.500"
                  : result != null && !isPendingConfirmation && !isCancelled
                    ? "green.500"
                    : textColor
              }
            />
          )}
        </Box>
      </HStack>
      {Object.keys(data.params).length > 0 && (
        <Box mt={2}>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setIsParamsOpen(!isParamsOpen)}
            rightIcon={isParamsOpen ? <LuChevronUp /> : <LuChevronDown />}
            w="full"
            justifyContent="space-between"
            color={textColor}
            fontSize="2xs"
            aria-expanded={isParamsOpen}
            aria-controls={`${detailsId}-params`}
          >
            {t("AgentChatPage.toolCall.params")}
          </Button>
          <Collapse in={isParamsOpen} animateOpacity>
            <Code
              id={`${detailsId}-params`}
              mt={1}
              display="block"
              whiteSpace="pre-wrap"
              overflowWrap="anywhere"
              maxH="64"
              overflow="auto"
              fontSize="2xs"
              p={2}
              borderRadius="md"
              bg={codeBgColor}
              className="allow-select"
              tabIndex={isParamsOpen ? 0 : -1}
            >
              {JSON.stringify(data.params, null, 2)}
            </Code>
          </Collapse>
        </Box>
      )}
      {isPendingConfirmation && (
        <HStack mt={2} spacing={2}>
          <Button
            size="xs"
            colorScheme="green"
            onClick={() => onConfirmationAction?.("confirm")}
            isDisabled={!onConfirmationAction}
            flex={1}
          >
            {t("AgentChatPage.toolCall.confirm")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            colorScheme="red"
            onClick={() => onConfirmationAction?.("cancel")}
            isDisabled={!onConfirmationAction}
            flex={1}
          >
            {t("AgentChatPage.toolCall.cancel")}
          </Button>
        </HStack>
      )}
      {!isPendingConfirmation && (result || error) && (
        <Box mt={2}>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setIsOpen(!isOpen)}
            rightIcon={isOpen ? <LuChevronUp /> : <LuChevronDown />}
            w="full"
            justifyContent="space-between"
            color={textColor}
            fontSize="2xs"
            aria-expanded={isOpen}
            aria-controls={`${detailsId}-result`}
          >
            {hasError
              ? t("AgentChatPage.toolCall.error")
              : t("AgentChatPage.toolCall.result")}
          </Button>
          <Collapse in={isOpen} animateOpacity>
            <Code
              id={`${detailsId}-result`}
              mt={1}
              display="block"
              whiteSpace="pre-wrap"
              overflowWrap="anywhere"
              maxH="64"
              overflow="auto"
              fontSize="2xs"
              p={2}
              borderRadius="md"
              bg={codeBgColor}
              colorScheme={hasError ? "red" : "green"}
              className="allow-select"
              tabIndex={isOpen ? 0 : -1}
            >
              {error || result}
            </Code>
          </Collapse>
        </Box>
      )}
    </Box>
  );
};
