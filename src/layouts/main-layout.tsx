import {
  Box,
  Button,
  Center,
  Flex,
  HStack,
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
  LuLanguages,
  LuPackagePlus,
  LuScrollText,
} from "react-icons/lu";
import { BeatLoader } from "react-spinners";
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
  const { openGenericConfirmDialog, openSharedModal } = useSharedModals();

  const [bgImgSrc, setBgImgSrc] = useState<string>("");
  const [isAgentChatOpen, setIsAgentChatOpen] = useState(false);
  const agentChatFrameRef = useRef<HTMLIFrameElement | null>(null);
  const isCheckedRunCount = useRef(false);
  const isCheckedLastRunStatus = useRef(false);
  const isLaunchPage = router.pathname === "/launch";
  const agentChatPanelRatio = 0.35;
  const agentChatPanelWidth = `${agentChatPanelRatio * 100}vw`;
  const agentChatPanelTransform =
    isLaunchPage && isAgentChatOpen ? "translateX(0)" : "translateX(-100%)";
  const launchContentOffset =
    isLaunchPage && isAgentChatOpen ? agentChatPanelWidth : "0px";
  const headNavOffset =
    isLaunchPage && isAgentChatOpen
      ? `${(agentChatPanelRatio * 100) / 2}vw`
      : "0px";

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

  // Bridge MiuChat iframe events to top-level shared modal system.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data?.type !== "sjmcl:miuchat-launch-instance") {
        return;
      }

      const instanceId = data?.payload?.instanceId;
      if (typeof instanceId !== "string" || !instanceId) {
        return;
      }

      openSharedModal("launch", { instanceId });
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [openSharedModal]);

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

  const notifyAgentChatTextVisibility = useCallback((visible: boolean) => {
    agentChatFrameRef.current?.contentWindow?.postMessage(
      {
        type: "sjmcl:miuchat-text-visibility",
        payload: { visible },
      },
      "*"
    );
  }, []);

  const openAgentChatPanel = () => {
    setIsAgentChatOpen(true);
    setTimeout(() => {
      notifyAgentChatTextVisibility(true);
    }, 180);
  };

  const closeAgentChatPanel = useCallback(() => {
    notifyAgentChatTextVisibility(false);
    setIsAgentChatOpen(false);
  }, [notifyAgentChatTextVisibility]);

  // When MiuChat is open, clicking anywhere on the right window area closes it.
  useEffect(() => {
    if (!isLaunchPage || !isAgentChatOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const panelWidth = window.innerWidth * agentChatPanelRatio;
      if (event.clientX > panelWidth) {
        closeAgentChatPanel();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isLaunchPage, isAgentChatOpen, closeAgentChatPanel]);

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
          <HeadNavBar leftOffset={headNavOffset} />
          {/* Keep iframe mounted to avoid reloading MiuChat when switching pages. */}
          <Flex
            position="absolute"
            left={0}
            top={0}
            h="100%"
            w={agentChatPanelWidth}
            overflow="hidden"
            transform={agentChatPanelTransform}
            transition="transform 0.35s ease"
            borderRightWidth={1}
            borderRightColor={
              isLaunchPage && isAgentChatOpen
                ? "blackAlpha.300"
                : "transparent"
            }
            zIndex={2}
            willChange="transform"
          >
            <Box
              as="iframe"
              ref={agentChatFrameRef}
              src="/standalone/agent-chat"
              border="none"
              w="100%"
              h="100%"
              onLoad={() => {
                notifyAgentChatTextVisibility(isAgentChatOpen);
              }}
            />
          </Flex>

          {isLaunchPage ? (
            <Flex
              flex={1}
              minW={0}
              minH={0}
              position="relative"
              ml={launchContentOffset}
              transition="margin-left 0.35s ease"
            >
              {!isAgentChatOpen && (
                <AgentHostess onToggleAgentChat={openAgentChatPanel} />
              )}
              {children}
            </Flex>
          ) : (
            <AdvancedCard
              level="back"
              flex="1"
              overflow="auto"
              mt={1}
              mb={4}
              mx={4}
            >
              {children}
            </AdvancedCard>
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
