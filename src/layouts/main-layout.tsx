import {
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Icon,
  Link,
  Text,
  useColorModeValue,
  useDisclosure,
} from "@chakra-ui/react";
import { exit } from "@tauri-apps/api/app";
import { appLogDir, join } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { t } from "i18next";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Trans } from "react-i18next";
import {
  LuGrid2X2Plus,
  LuGripVertical,
  LuLanguages,
  LuPackagePlus,
  LuScrollText,
} from "react-icons/lu";
import { BeatLoader } from "react-spinners";
import AgentChat from "@/components/agent-chat";
import AgentHostess from "@/components/agent-hostess";
import AdvancedCard from "@/components/common/advanced-card";
import DevToolbar from "@/components/dev/dev-toolbar";
import LanguageMenu from "@/components/language-menu";
import StarUsModal from "@/components/modals/star-us-modal";
import WelcomeAndTermsModal from "@/components/modals/welcome-and-terms-modal";
import {
  FileDnDProvider,
  useFileDnD,
} from "@/components/special/file-dnd-overlay";
import WindowTitlebar from "@/components/window-titlebar";
import { useAgentChat } from "@/contexts/agent-chat";
import { useLauncherConfig } from "@/contexts/config";
import { useExtensionHost } from "@/contexts/extension/host";
import { useSharedModals } from "@/contexts/shared-modal";
import { isDev } from "@/utils/env";

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const router = useRouter();
  const isStandAlone = router.pathname.startsWith("/standalone");
  const { config, update, bgImageSrc, isBgDarken } = useLauncherConfig();
  const primaryColor = config.appearance.theme.primaryColor;
  const { openGenericConfirmDialog } = useSharedModals();

  const isStartupFlowStarted = useRef(false);
  const {
    isOpen: isAgentChatOpen,
    open: openAgentChat,
    close: closeAgentChat,
  } = useAgentChat();
  const [panelWidth, setPanelWidth] = useState(300);
  const [isDragging, setIsDragging] = useState(false);
  const originalHeadNavStyle = useRef(config.appearance.theme.headNavStyle);
  const isLaunchPage = router.pathname === "/launch";
  const agentChatPanelWidth = `${panelWidth}px`;
  const agentChatPanelTransform = isAgentChatOpen
    ? "translateX(0)"
    : "translateX(-100%)";
  const agentChatPanelOffset = isAgentChatOpen ? agentChatPanelWidth : "0px";

  useEffect(() => {
    update(
      "appearance.theme.headNavStyle",
      isAgentChatOpen ? "simplified" : originalHeadNavStyle.current
    );
  }, [isAgentChatOpen, update]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging) return;
      const maxWidth = Math.max(250, window.innerWidth - 450);
      setPanelWidth(Math.min(Math.max(event.clientX, 250), maxWidth));
    };

    const handleMouseUp = () => {
      if (!isDragging) return;
      setIsDragging(false);
      document.body.style.cursor = "default";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsDragging(true);
    document.body.style.cursor = "col-resize";
  };

  const {
    isOpen: isWelcomeAndTermsModalOpen,
    onOpen: onWelcomeAndTermsModalOpen,
    onClose: onWelcomeAndTermsModalClose,
  } = useDisclosure();

  const {
    isOpen: isStarUsModalOpen,
    onOpen: onStarUsModalOpen,
    onClose: onStarUsModalClose,
  } = useDisclosure();

  const openUnavailableExePathDialog = useCallback(
    (onContinue: () => void) => {
      openGenericConfirmDialog({
        title: t("UnavailableExePathAlertDialog.dialog.title"),
        body: t("UnavailableExePathAlertDialog.dialog.content"),
        btnCancel: t("UnavailableExePathAlertDialog.dialog.btnContinue"),
        onCancelCallback: onContinue,
        btnOK: t("General.exit"),
        onOKCallback: () => exit(0),
        footerLeft: (
          <HStack spacing={2}>
            <LuLanguages />
            <LanguageMenu placement="top" />
          </HStack>
        ),
        isAlert: true,
        closeOnEsc: false,
        closeOnOverlayClick: false,
        showCloseBtn: false,
      });
    },
    [openGenericConfirmDialog]
  );

  const openLastExitedAbnormallyDialog = useCallback(
    (onContinue: () => void) => {
      openGenericConfirmDialog({
        title: t("LastExitedAbnormallyDialog.dialog.title"),
        btnCancel: "",
        showSuppressBtn: true,
        suppressKey: "lastExitedAbnormally",
        onOKCallback: onContinue,
        onCancelCallback: onContinue,
        body: (
          <Text color="gray.500">
            <Trans
              i18nKey="LastExitedAbnormallyDialog.dialog.content"
              components={{
                community: (
                  <Link
                    color={`${primaryColor}.500`}
                    onClick={() =>
                      openUrl(t("HelpSettingsPage.top.settings.UserGroup.url"))
                    }
                  />
                ),
                github: (
                  <Link
                    color={`${primaryColor}.500`}
                    onClick={() =>
                      openUrl("https://github.com/UNIkeEN/SJMCL/issues")
                    }
                  />
                ),
              }}
            />
          </Text>
        ),
        footerLeft: (
          <HStack>
            <LuScrollText />
            <Button
              variant="link"
              colorScheme={primaryColor}
              onClick={async () => {
                const _appLogDir = await appLogDir();
                const launcherLogDir = await join(_appLogDir, "launcher");
                await openPath(launcherLogDir);
              }}
            >
              {t("LastExitedAbnormallyDialog.dialog.viewLog")}
            </Button>
          </HStack>
        ),
      });
    },
    [openGenericConfirmDialog, primaryColor]
  );

  useEffect(() => {
    if (config.mocked || isStandAlone || isStartupFlowStarted.current) return;
    isStartupFlowStarted.current = true;

    // update `last_run_exited_normally` to false, will be updated when this run ends with normal exit.
    update("lastRunExitedNormally", false);

    const handleStartup = async () => {
      if (!config.basicInfo.isExePathAvailable) {
        await new Promise<void>((resolve) => {
          openUnavailableExePathDialog(resolve);
        });
      }

      if (!config.lastRunExitedNormally) {
        await new Promise<void>((resolve) => {
          openLastExitedAbnormallyDialog(resolve);
        });
      }

      // update run count, conditionally show some modals.
      if (!config.runCount) {
        setTimeout(() => {
          onWelcomeAndTermsModalOpen();
        }, 300); // some delay to avoid sudden popup
      } else {
        let newCount = config.runCount + 1;
        if (newCount === 10) {
          setTimeout(() => {
            onStarUsModalOpen();
          }, 300);
        }
        update("runCount", newCount);
      }
    };

    handleStartup();
  }, [
    config.mocked,
    config.runCount,
    config.lastRunExitedNormally,
    config.basicInfo.isExePathAvailable,
    isStandAlone,
    openLastExitedAbnormallyDialog,
    openUnavailableExePathDialog,
    onWelcomeAndTermsModalOpen,
    onStarUsModalOpen,
    update,
  ]);

  // update font family to body CSS by config.
  useEffect(() => {
    const body = document.body;
    const fontFamily = config.appearance.font.fontFamily;

    if (fontFamily !== "%built-in") {
      body.setAttribute("use-custom-font", "true");
      body.style.setProperty("--custom-global-font-family", fontFamily);
    } else {
      body.removeAttribute("use-custom-font");
      body.style.removeProperty("--custom-global-font-family");
    }
  }, [config.appearance.font.fontFamily]);

  // update font size to body CSS by config.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevMd =
      parseFloat(
        getComputedStyle(root).getPropertyValue("--chakra-fontSizes-md")
      ) || 1;
    const ratio =
      Math.min(115, Math.max(85, config.appearance.font.fontSize)) /
      100 /
      prevMd;

    const computedStyle = getComputedStyle(root);
    for (let i = 0; i < computedStyle.length; i++) {
      const key = computedStyle[i];
      if (key.startsWith("--chakra-fontSizes-")) {
        const originalValue =
          parseFloat(computedStyle.getPropertyValue(key)) || 1;
        body.style.setProperty(key, `${originalValue * ratio}rem`, "important");
      }
    }
  }, [config.appearance.font.fontSize]);

  const getGlobalExtraStyle = (config: any) => {
    const isInvertColors = config.appearance.accessibility.invertColors;
    const enhanceContrast = config.appearance.accessibility.enhanceContrast;

    const filters = [];
    if (isInvertColors) filters.push("invert(1)");
    if (enhanceContrast) filters.push("contrast(1.2)");

    return {
      filter: filters.length > 0 ? filters.join(" ") : "none",
    };
  };

  const standaloneBgColor = useColorModeValue(
    "white",
    "var(--chakra-colors-gray-900)"
  );
  const resizeHoverBg = useColorModeValue("blackAlpha.600", "whiteAlpha.600");
  const resizeHoverIconColor = useColorModeValue(
    "whiteAlpha.800",
    "blackAlpha.800"
  );

  const linuxBorderStyle = {
    border: "0.5px solid",
    borderColor: "gray.500",
    borderRadius: "lg",
  };

  if (isStandAlone) {
    return (
      <Flex
        direction="column"
        h="100vh"
        overflow="hidden"
        {...(config.basicInfo.osType === "linux" && linuxBorderStyle)}
        style={{
          ...getGlobalExtraStyle(config),
          backgroundColor: standaloneBgColor,
        }}
      >
        <WindowTitlebar />
        <Box flex="1" minH={0} overflow="auto">
          {children}
        </Box>
        {isDev && <DevToolbar />}
      </Flex>
    );
  }

  if (config.mocked)
    return (
      <Center h="100vh" style={getGlobalExtraStyle(config)}>
        <BeatLoader size={16} color="gray" />
      </Center>
    );

  const handleAgentChatOpen = (state: boolean) => {
    if (state) {
      openAgentChat();
    } else {
      closeAgentChat();
    }
  };

  return (
    <Flex
      direction="column"
      h="100vh"
      bgImg={`url('${bgImageSrc}')`}
      bgSize="cover"
      bgPosition="center"
      bgRepeat="no-repeat"
      bgColor={isBgDarken ? "rgba(0,0,0,0.45)" : "transparent"}
      bgBlendMode={isBgDarken ? "darken" : "normal"}
      {...(config.basicInfo.osType === "linux" && linuxBorderStyle)}
      overflow="hidden"
      style={getGlobalExtraStyle(config)}
    >
      <WindowTitlebar />
      <Box
        position="relative"
        display="flex"
        flex="1"
        flexDir="column"
        minH={0}
      >
        <FileDnDProvider>
          <MainLayoutFileDnD />
          <Flex flex="1" minH={0} w="full" flexDir="row">
            <Flex
              w={agentChatPanelOffset}
              overflow="hidden"
              transform={agentChatPanelTransform}
              transition="transform 0.35s ease"
              p={isAgentChatOpen ? 2 : 0}
              position="relative"
            >
              {isAgentChatOpen && (
                <>
                  <AgentChat
                    onAgentChatPanelClose={() => handleAgentChatOpen(false)}
                  />
                  <Flex
                    role="group"
                    position="absolute"
                    top={0}
                    right={0}
                    w={2}
                    h="100%"
                    borderRadius="full"
                    cursor="col-resize"
                    onMouseDown={startResize}
                    zIndex={10}
                    transition="background 0.2s"
                    bgColor={isDragging ? resizeHoverBg : "transparent"}
                    _hover={{ bgColor: resizeHoverBg }}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Icon
                      as={LuGripVertical}
                      opacity={isDragging ? 1 : 0}
                      color={resizeHoverIconColor}
                      _groupHover={{ opacity: 1 }}
                      transition="opacity 0.2s"
                    />
                  </Flex>
                </>
              )}
            </Flex>

            <Flex flex={1} minW={0} minH={0} p={2} pl={0}>
              {isLaunchPage ? (
                children
              ) : (
                <AdvancedCard
                  w="full"
                  h="full"
                  level="back"
                  overflow="auto"
                  borderRadius="xl"
                >
                  {children}
                </AdvancedCard>
              )}
            </Flex>
          </Flex>
          {isLaunchPage && !isAgentChatOpen && (
            <AgentHostess onToggleAgentChat={() => handleAgentChatOpen(true)} />
          )}
          <WelcomeAndTermsModal
            isOpen={isWelcomeAndTermsModalOpen}
            onClose={onWelcomeAndTermsModalClose}
          />
          <StarUsModal
            isOpen={isStarUsModalOpen}
            onClose={onStarUsModalClose}
          />

          {isDev && <DevToolbar />}
        </FileDnDProvider>
      </Box>
    </Flex>
  );
};

// support modpack and extension import by DnD on the whole main-layout level
const MainLayoutFileDnD = () => {
  const { openSharedModal } = useSharedModals();
  const { handleAddExtension } = useExtensionHost();

  useFileDnD({
    extensions: ["zip", "mrpack"],
    titleKey: "MainLayout.fileDnD.title",
    descKey: "MainLayout.fileDnD.desc",
    icon: LuPackagePlus,
    onDrop: async ([path]) => {
      if (!path) return;
      openSharedModal("import-modpack", { path });
    },
  });

  useFileDnD({
    extensions: ["sjmclx"],
    titleKey: "ExtensionSettingsPage.fileDnD.title",
    descKey: "ExtensionSettingsPage.fileDnD.desc",
    icon: LuGrid2X2Plus,
    onDrop: async ([path]) => {
      if (!path) return;
      await handleAddExtension(path);
    },
  });

  return null;
};

export default MainLayout;
