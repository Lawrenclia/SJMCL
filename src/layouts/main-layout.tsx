import {
  Box,
  Button,
  Center,
  Flex,
  HStack,
  Icon,
  Link,
  Text,
  useColorMode,
  useColorModeValue,
  useDisclosure,
} from "@chakra-ui/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, appLogDir, join } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { exit } from "@tauri-apps/plugin-process";
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
import HeadNavBar from "@/components/head-navbar-v2";
import LanguageMenu from "@/components/language-menu";
import MainWindowTitlebar from "@/components/main-window-titlebar";
import StarUsModal from "@/components/modals/star-us-modal";
import WelcomeAndTermsModal from "@/components/modals/welcome-and-terms-modal";
import {
  FileDnDProvider,
  useFileDnD,
} from "@/components/special/file-dnd-overlay";
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
  const { config, update } = useLauncherConfig();
  const primaryColor = config.appearance.theme.primaryColor;
  const { colorMode } = useColorMode();
  const isDarkenBg =
    colorMode === "dark" && config.appearance.background.autoDarken;
  const { openGenericConfirmDialog } = useSharedModals();

  const [bgImgSrc, setBgImgSrc] = useState<string>("");
  const [isAgentChatOpen, setIsAgentChatOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(300);
  const isDragging = useRef(false);
  const originalHeadNavStyle = useRef(config.appearance.theme.headNavStyle);
  const isCheckedRunCount = useRef(false);
  const isCheckedLastRunStatus = useRef(false);
  const isLaunchPage = router.pathname === "/launch";
  const agentChatPanelWidth = `${panelWidth}px`;
  const agentChatPanelTransform = isAgentChatOpen
    ? "translateX(0)"
    : "translateX(-100%)";
  const agentChatPanelOffset = isAgentChatOpen ? agentChatPanelWidth : "0px";

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging.current) return;
      const maxWidth = Math.max(250, window.innerWidth - 450);
      setPanelWidth(Math.min(Math.max(event.clientX, 250), maxWidth));
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "default";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    isDragging.current = true;
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

  const openUnavailableExePathDialog = useCallback(() => {
    openGenericConfirmDialog({
      title: t("UnavailableExePathAlertDialog.dialog.title"),
      body: t("UnavailableExePathAlertDialog.dialog.content"),
      btnCancel: t("UnavailableExePathAlertDialog.dialog.btnContinue"),
      onCancelCallback: () => update("runCount", config.runCount + 1), // because this dialog will skip the run count check
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
  }, [config.runCount, openGenericConfirmDialog, update]);

  const openLastExitedAbnormallyDialog = useCallback(() => {
    openGenericConfirmDialog({
      title: t("LastExitedAbnormallyDialog.dialog.title"),
      btnCancel: "",
      showSuppressBtn: true,
      suppressKey: "lastExitedAbnormally",
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
  }, [openGenericConfirmDialog, primaryColor]);

  useEffect(() => {
    // running in unavailable path, show alert dialog.
    if (!config.mocked && !config.basicInfo.isExePathAvailable) {
      openUnavailableExePathDialog();
      isCheckedRunCount.current = true; // skip run count check below
    }

    // update `last_run_exited_normally` to false, will be updated when this run ends with normal exit.
    if (!config.mocked && !isCheckedLastRunStatus.current && !isStandAlone) {
      if (!config.lastRunExitedNormally) {
        openLastExitedAbnormallyDialog();
      }
      update("lastRunExitedNormally", false);
      isCheckedLastRunStatus.current = true;
    }

    // update run count, conditionally show some modals.
    if (!config.mocked && !isCheckedRunCount.current && !isStandAlone) {
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
      isCheckedRunCount.current = true;
    }
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

  // construct background img src url from config.
  useEffect(() => {
    const constructBgImgSrc = async () => {
      const bgKey = config.appearance.background.choice;
      if (bgKey.startsWith("%built-in:")) {
        const builtInKey = bgKey.replace("%built-in:", "");
        setBgImgSrc(`/images/backgrounds/${builtInKey}-${colorMode}.jpg`);
      } else {
        const _appDataDir = await appDataDir();
        setBgImgSrc(
          convertFileSrc(`${_appDataDir}/UserContent/Backgrounds/${bgKey}`) +
            `?t=${Date.now()}`
        );
      }
    };

    constructBgImgSrc();
  }, [colorMode, config.appearance.background.choice]);

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

  if (isStandAlone) {
    return (
      <div
        style={{
          ...getGlobalExtraStyle(config),
          backgroundColor: standaloneBgColor,
        }}
      >
        {children}
        {isDev && <DevToolbar />}
      </div>
    );
  }

  if (config.mocked)
    return (
      <Center h="100vh" style={getGlobalExtraStyle(config)}>
        <BeatLoader size={16} color="gray" />
      </Center>
    );

  const handleAgentChatOpen = (state: boolean) => {
    update(
      "appearance.theme.headNavStyle",
      state ? "simplified" : originalHeadNavStyle.current
    );
    setIsAgentChatOpen(state);
  };

  return (
    <Flex
      direction="column"
      h="100vh"
      bgImg={`url('${bgImgSrc}')`}
      bgSize="cover"
      bgPosition="center"
      bgRepeat="no-repeat"
      bgColor={isDarkenBg ? "rgba(0,0,0,0.45)" : "transparent"}
      bgBlendMode={isDarkenBg ? "darken" : "normal"}
      {...(config.basicInfo.osType === "linux" && {
        border: "0.5px solid",
        borderColor: "gray.500",
        borderRadius: "lg",
      })}
      overflow="hidden"
      style={getGlobalExtraStyle(config)}
    >
      <MainWindowTitlebar />
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
                    w="12px"
                    h="100%"
                    borderRadius="full"
                    cursor="col-resize"
                    onMouseDown={startResize}
                    zIndex={10}
                    transition="background 0.2s"
                    _hover={{ bg: resizeHoverBg }}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Icon
                      as={LuGripVertical}
                      opacity={0}
                      color={resizeHoverIconColor}
                      _groupHover={{ opacity: 1 }}
                      transition="opacity 0.2s"
                    />
                  </Flex>
                </>
              )}
            </Flex>

            <Flex
              flex={1}
              flexDir="column"
              justify="space-between"
              minW={0}
            >
              <HeadNavBar />
              <Flex flex={1} minH={0} p={2} pt={0}>
                {isLaunchPage ? (
                  children
                ) : (
                  <AdvancedCard
                    w="full"
                    h="full"
                    level="back"
                    overflow="auto"
                    borderRadius="2xl"
                  >
                    {children}
                  </AdvancedCard>
                )}
              </Flex>
            </Flex>
          </Flex>
          {isLaunchPage && !isAgentChatOpen && (
            <AgentHostess
              onToggleAgentChat={() => handleAgentChatOpen(true)}
            />
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
