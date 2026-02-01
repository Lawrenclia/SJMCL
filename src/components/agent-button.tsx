import { Box } from "@chakra-ui/react";
import type { FC } from "react";

interface AgentButtonProps {
  onClick?: () => void;
}

const AGENT_BUTTON_SRC = "/images/agent/agentButton.png";
const AGENT_BUTTON_HOVER_SRC = "/images/agent/agentButton_hover.png";

const AgentButton: FC<AgentButtonProps> = ({ onClick }) => {
  return (
    <Box
      as="button"
      aria-label="Agent button"
      onClick={onClick}
      position="fixed"
      left={0}
      top="50%"
      transform="translateY(-50%)"
      width={{ base: "120px", md: "150px" }}
      height={{ base: "168px", md: "210px" }}
      bgImage={`url('${AGENT_BUTTON_SRC}')`}
      bgRepeat="no-repeat"
      bgSize="contain"
      bgPosition="center"
      cursor="pointer"
      border="none"
      bgColor="transparent"
      transition="transform 0.2s ease, background-image 0.15s ease"
      zIndex={1200}
      _hover={{
        bgImage: `url('${AGENT_BUTTON_HOVER_SRC}')`,
        transform: "translateY(-50%) scale(1.02)",
      }}
      _active={{
        transform: "translateY(-50%) scale(0.98)",
      }}
      _focusVisible={{
        boxShadow: "0 0 0 3px rgba(66, 153, 225, 0.6)",
      }}
    />
  );
};

export default AgentButton;
