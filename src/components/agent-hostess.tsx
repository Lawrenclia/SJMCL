import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuGamepad2, LuMessageCircleMore, LuSettings } from "react-icons/lu";
import { useLauncherConfig } from "@/contexts/config";
import { useGlobalData } from "@/contexts/global-data";
import { useSharedModals } from "@/contexts/shared-modal";
import AdvancedCard from "./common/advanced-card";

interface AgentHostessProps {
  onToggleAgentChat: () => void;
}

const AGENT_HOSTESS_SRC = "/images/agent/miuxi_2d.png";
const AgentHostess: FC<AgentHostessProps> = ({ onToggleAgentChat }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { config } = useLauncherConfig();
  const { selectedPlayer } = useGlobalData();
  const { openSharedModal } = useSharedModals();
  const agentEnabled = config.intelligence.enabled;
  const primaryColor = config.appearance.theme.primaryColor;
  const [isOnHover, setIsOnHover] = useState(false);
  const toggleAgentChatOrRedirect = () => {
    if (agentEnabled) {
      onToggleAgentChat();
    } else {
      router.push("/settings/intelligence");
    }
  };
  return (
    <HStack
      position="fixed"
      left={0}
      top="50%"
      transform="translateY(-50%)"
      onMouseOver={() => setIsOnHover(true)}
      onMouseOut={() => setIsOnHover(false)}
    >
      <Box
        as="button"
        aria-label="Agent button"
        width={180}
        height={280}
        bgImage={`url('${AGENT_HOSTESS_SRC}')`}
        bgRepeat="no-repeat"
        bgSize="contain"
        bgPosition="center"
        cursor="pointer"
        border="none"
        bgColor="transparent"
        transition="transform 0.2s ease"
        _hover={{
          transform: "scale(1.02)",
        }}
      />
      <VStack
        transition="all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
        opacity={isOnHover ? 1 : 0}
        transformOrigin="left"
        transform={
          isOnHover ? "scale(1) translateX(0)" : "scale(0.5) translateX(-20px)"
        }
        pointerEvents={isOnHover ? "auto" : "none"}
        mt="-100"
        ml="-10"
        alignItems="flex-start"
      >
        <AdvancedCard p="2" borderRadius="xl" borderBottomLeftRadius="none">
          <Text
            fontSize="md"
            fontWeight="bold"
            bgGradient={`linear(to-r, ${primaryColor}.500, ${primaryColor}.300)`}
            bgClip="text"
          >
            {t("AgentButton." + (agentEnabled ? "enabled" : "disabled"), {
              name: selectedPlayer?.name || "",
            })}
          </Text>
          <Button
            onClick={toggleAgentChatOrRedirect}
            mt="2"
            colorScheme={primaryColor}
          >
            <Icon
              as={agentEnabled ? LuMessageCircleMore : LuSettings}
              boxSize={3.5}
              mr="2"
            />
            {t(
              `AgentButton.` +
                (agentEnabled ? "startChatting" : "turnToSettings")
            )}
          </Button>
        </AdvancedCard>

        {agentEnabled && (
          <AdvancedCard p="2" borderRadius="xl" borderBottomLeftRadius="none">
            <Text
              fontSize="md"
              fontWeight="bold"
              bgGradient={`linear(to-r, ${primaryColor}.500, ${primaryColor}.300)`}
              bgClip="text"
            >
              {t("AgentButton.joinGame")}
            </Text>
            <Button
              onClick={() => openSharedModal("agent-join-game")}
              mt="2"
              colorScheme={primaryColor}
            >
              <Icon as={LuGamepad2} boxSize={3.5} mr="2" />
              {t("AgentButton.joinGameConfirm")}
            </Button>
          </AdvancedCard>
        )}
      </VStack>
    </HStack>
  );
};

export default AgentHostess;
