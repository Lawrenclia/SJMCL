import {
  Box,
  Button,
  Code,
  Collapse,
  HStack,
  Icon,
  Text,
  useColorModeValue,
} from "@chakra-ui/react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { LuChevronDown, LuChevronUp, LuZap } from "react-icons/lu";
import { formatPrintable } from "@/utils/string";

// Interface for the function call parameters
export interface FunctionCallParams {
  name: string;
  params: Record<string, any>;
}

export const FunctionCallWidget: React.FC<{
  data: FunctionCallParams;
  onInvoke?: (name: string, params: Record<string, any>) => Promise<any> | void;
}> = ({ data, onInvoke }) => {
  const { t } = useTranslation();
  const bgColor = useColorModeValue("purple.50", "purple.900");
  const borderColor = useColorModeValue("purple.200", "purple.700");
  const textColor = useColorModeValue("purple.800", "purple.100");
  const codeBgColor = useColorModeValue("whiteAlpha.500", "blackAlpha.400");

  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleInvoke = async () => {
    if (onInvoke) {
      setIsLoading(true);
      setResult(null);
      try {
        const res = await onInvoke(data.name, data.params);
        if (res) {
          setResult(formatPrintable(res));
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <Box
      mt={3}
      p={3}
      borderRadius="md"
      borderWidth="1px"
      bg={bgColor}
      borderColor={borderColor}
    >
      <HStack justify="space-between">
        <HStack>
          <Icon as={LuZap} color={textColor} />
          <Text fontWeight="bold" fontSize="sm" color={textColor}>
            {t("AgentChatPage.functionCall.title")}: {data.name}
          </Text>
        </HStack>
        {!result && (
          <Button
            size="xs"
            colorScheme="purple"
            variant="solid"
            onClick={handleInvoke}
            isLoading={isLoading}
          >
            {t("AgentChatPage.functionCall.execute")}
          </Button>
        )}
      </HStack>
      {Object.keys(data.params).length > 0 && (
        <Code
          mt={2}
          display="block"
          whiteSpace="pre-wrap"
          fontSize="xs"
          p={2}
          borderRadius="md"
          bg={codeBgColor}
        >
          {JSON.stringify(data.params, null, 2)}
        </Code>
      )}
      {result && (
        <Box mt={2}>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setIsOpen(!isOpen)}
            rightIcon={isOpen ? <LuChevronUp /> : <LuChevronDown />}
            w="full"
            justifyContent="space-between"
            color={textColor}
            fontSize="xs"
          >
            {t("AgentChatPage.functionCall.result")}
          </Button>
          <Collapse in={isOpen} animateOpacity>
            <Code
              mt={1}
              display="block"
              whiteSpace="pre-wrap"
              fontSize="xs"
              p={2}
              borderRadius="md"
              bg={codeBgColor}
              colorScheme="green"
            >
              {result}
            </Code>
          </Collapse>
        </Box>
      )}
    </Box>
  );
};
