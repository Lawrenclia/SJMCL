import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  Center,
  Flex,
  Icon,
  Input,
  Kbd,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalProps,
  Step,
  StepDescription,
  StepIcon,
  StepIndicator,
  StepNumber,
  StepSeparator,
  StepStatus,
  StepTitle,
  Stepper,
  Text,
  VStack,
  useSteps,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuBot, LuBotOff } from "react-icons/lu";
import { BeatLoader } from "react-spinners";
import { OptionItemGroup } from "@/components/common/option-item";
import InstancesView from "@/components/instances-view";
import PlayersView from "@/components/players-view";
import { useLauncherConfig } from "@/contexts/config";
import { useGlobalData } from "@/contexts/global-data";
import { useSharedModals } from "@/contexts/shared-modal";
import { useToast } from "@/contexts/toast";
import { PlayerType } from "@/enums/account";
import { Player } from "@/models/account";
import { InstanceSummary } from "@/models/instance/misc";
import { IntelligenceService } from "@/services/intelligence";
import { isOfflinePlayernameValid } from "@/utils/account";

const SUPPORTED_BOT_GAME_VERSION = "26.1";

const isSupportedInstance = (instance: InstanceSummary): boolean => {
  return instance.version === SUPPORTED_BOT_GAME_VERSION;
};

const AgentJoinGameModal: React.FC<Omit<ModalProps, "children">> = ({
  ...modalProps
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { config, update } = useLauncherConfig();
  const { getPlayerList, getInstanceList } = useGlobalData();
  const { openSharedModal } = useSharedModals();

  const primaryColor = config.appearance.theme.primaryColor;

  const { activeStep, setActiveStep } = useSteps({
    index: 0,
    count: 3,
  });

  const [offlinePlayers, setOfflinePlayers] = useState<Player[]>([]);
  const [supportedInstances, setSupportedInstances] = useState<
    InstanceSummary[]
  >([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player>();
  const [selectedInstance, setSelectedInstance] = useState<InstanceSummary>();
  const [serverPort, setServerPort] = useState(0);
  const [botName, setBotName] = useState("Miuxi");
  const [isLaunching, setIsLaunching] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isBotInGame, setIsBotInGame] = useState(false);
  const [botExitReason, setBotExitReason] = useState("not_in_game");
  const [isBotExitListening, setIsBotExitListening] = useState(false);

  useEffect(() => {
    const players = getPlayerList() || [];
    const instances = getInstanceList() || [];

    const filteredPlayers = players.filter(
      (player) => player.playerType === PlayerType.Offline
    );
    const filteredInstances = instances.filter(isSupportedInstance);

    setOfflinePlayers(filteredPlayers);
    setSupportedInstances(filteredInstances);

    if (
      selectedPlayer &&
      !filteredPlayers.some((player) => player.id === selectedPlayer.id)
    ) {
      setSelectedPlayer(undefined);
    }

    if (
      selectedInstance &&
      !filteredInstances.some((instance) => instance.id === selectedInstance.id)
    ) {
      setSelectedInstance(undefined);
    }
  }, [getInstanceList, getPlayerList, selectedInstance, selectedPlayer]);

  const handleLaunchSelectedInstance = useCallback(() => {
    if (!selectedPlayer || !selectedInstance) return;

    setIsLaunching(true);
    update("states.shared.selectedPlayerId", selectedPlayer.id);
    update("states.shared.selectedInstanceId", selectedInstance.id);

    openSharedModal("launch", {
      playerId: selectedPlayer.id,
      instanceId: selectedInstance.id,
    });

    setIsLaunching(false);
    setActiveStep(2);
  }, [
    openSharedModal,
    selectedInstance,
    selectedPlayer,
    setActiveStep,
    update,
  ]);

  const handleJoinServer = useCallback(() => {
    if (!serverPort) return;

    if (!isBotExitListening) {
      setIsBotExitListening(true);
    }

    setIsJoining(true);
    IntelligenceService.joinLocalServer(serverPort, botName)
      .then((response) => {
        if (response.status === "success") {
          setIsBotInGame(true);
          setBotExitReason("");
        } else {
          setIsBotInGame(false);
          toast({
            title: response.message,
            description: response.details,
            status: "error",
          });
        }
      })
      .finally(() => setIsJoining(false));
  }, [botName, isBotExitListening, serverPort, toast]);

  useEffect(() => {
    if (!isBotExitListening) return;

    const stopListening = IntelligenceService.onBotExit((payload) => {
      setIsBotInGame(false);
      setBotExitReason(payload.reason || "未知原因");
    });

    return () => {
      stopListening();
    };
  }, [isBotExitListening]);

  useEffect(() => {
    const stopListening = IntelligenceService.onServerPort((payload) => {
      if (!payload.port) return;
      setServerPort(parseInt(payload.port));
    });

    return () => {
      stopListening();
    };
  }, []);

  const isNameAvailable =
    isOfflinePlayernameValid(botName) &&
    botName.trim() !== "" &&
    botName !== selectedPlayer?.name;

  const step1Content = useMemo(() => {
    return (
      <>
        <ModalBody display="flex" flexDir="column" flex="1" minH={0}>
          {offlinePlayers.length ? (
            <PlayersView
              players={offlinePlayers}
              selectedPlayer={selectedPlayer}
              viewType="list"
              withMenu={false}
              onSelectPlayer={setSelectedPlayer}
              onWheel={(e) => {
                e.stopPropagation();
              }}
            />
          ) : (
            <Center h="100%" flexDir="column" gap={3}>
              <Text fontSize="sm" className="secondary-text">
                {t("AgentJoinGameModal.steps.player.noOfflineAccounts")}
              </Text>
              <Button
                colorScheme={primaryColor}
                onClick={() => {
                  openSharedModal("add-player", {
                    initialPlayerType: PlayerType.Offline,
                    initialAuthServerUrl: "",
                  });
                }}
              >
                {t("AgentJoinGameModal.steps.player.addOfflineAccount")}
              </Button>
            </Center>
          )}
        </ModalBody>
        <ModalFooter mt={1}>
          <Button variant="ghost" onClick={modalProps.onClose}>
            {t("General.cancel")}
          </Button>
          <Button
            colorScheme={primaryColor}
            disabled={!selectedPlayer}
            onClick={() => setActiveStep(1)}
          >
            {t("General.next")}
          </Button>
        </ModalFooter>
      </>
    );
  }, [
    modalProps.onClose,
    offlinePlayers,
    openSharedModal,
    primaryColor,
    selectedPlayer,
    setActiveStep,
    t,
  ]);

  const step2Content = useMemo(() => {
    return (
      <>
        <ModalBody display="flex" flexDir="column" flex="1" minH={0}>
          {supportedInstances.length ? (
            <InstancesView
              instances={supportedInstances}
              selectedInstance={selectedInstance}
              viewType="list"
              withMenu={false}
              onSelectInstance={setSelectedInstance}
              onWheel={(e) => {
                e.stopPropagation();
              }}
            />
          ) : (
            <Center h="100%" flexDir="column" gap={3}>
              <Text fontSize="sm" className="secondary-text">
                {t("AgentJoinGameModal.steps.instance.noSupportedInstances", {
                  version: SUPPORTED_BOT_GAME_VERSION,
                })}
              </Text>
              <Button
                colorScheme={primaryColor}
                onClick={() => {
                  openSharedModal("create-instance", {
                    initialGameType: "release",
                    initialGameId: SUPPORTED_BOT_GAME_VERSION,
                  });
                }}
              >
                {t("AgentJoinGameModal.steps.instance.goCreateInstance")}
              </Button>
            </Center>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={modalProps.onClose}>
            {t("General.cancel")}
          </Button>
          <Button variant="ghost" onClick={() => setActiveStep(0)}>
            {t("General.previous")}
          </Button>
          <Button
            colorScheme={primaryColor}
            onClick={handleLaunchSelectedInstance}
            isLoading={isLaunching}
            disabled={!selectedPlayer || !selectedInstance}
          >
            {t("AgentJoinGameModal.steps.instance.launchAndNext")}
          </Button>
        </ModalFooter>
      </>
    );
  }, [
    handleLaunchSelectedInstance,
    isLaunching,
    modalProps.onClose,
    openSharedModal,
    primaryColor,
    selectedInstance,
    selectedPlayer,
    setActiveStep,
    supportedInstances,
    t,
  ]);

  const step3Content = useMemo(() => {
    return (
      <>
        <ModalBody>
          <VStack spacing={4} align="stretch" h="100%">
            <Alert status="info" borderRadius="md" fontSize="sm">
              <AlertIcon />
              {t("AgentJoinGameModal.steps.server.description1")}
              <Kbd>Esc</Kbd>
              {t("AgentJoinGameModal.steps.server.description2")}
            </Alert>

            <OptionItemGroup
              items={[
                {
                  title: t("AgentJoinGameModal.steps.server.port"),
                  description: t(
                    "AgentJoinGameModal.steps.server.portDescription"
                  ),
                  children: (
                    <Box pt={1}>
                      {!serverPort ? (
                        <BeatLoader loading={true} size={12} />
                      ) : (
                        serverPort
                      )}
                    </Box>
                  ),
                },
                {
                  title: t("AgentJoinGameModal.steps.server.botName"),
                  description:
                    isNameAvailable || !botName.trim()
                      ? t("AgentJoinGameModal.steps.server.botNameDescription")
                      : t("AgentJoinGameModal.steps.server.botNameInvalid"),
                  children: (
                    <Box pt={1}>
                      <Input
                        value={botName}
                        onChange={(e) => setBotName(e.target.value)}
                        focusBorderColor={`${primaryColor}.500`}
                        isInvalid={!isNameAvailable}
                      />
                    </Box>
                  ),
                },
              ]}
            />

            <Card
              w="100%"
              flex={1}
              variant="filled"
              display="flex"
              alignItems="center"
              justifyContent="center"
              borderStyle="dashed"
            >
              <VStack spacing={1} align="center">
                {isBotInGame ? (
                  <Icon as={LuBot} boxSize={8} color="green.600" />
                ) : (
                  <Icon as={LuBotOff} boxSize={8} color="red.600" />
                )}

                <Text
                  fontSize="xs"
                  className="secondary-text"
                  textAlign="center"
                >
                  {isBotInGame
                    ? t("AgentJoinGameModal.steps.server.botInGame")
                    : t(
                        `AgentJoinGameModal.steps.server.error.${botExitReason || "unknown"}`
                      )}
                </Text>
              </VStack>
            </Card>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={modalProps.onClose}>
            {t("General.cancel")}
          </Button>
          <Button variant="ghost" onClick={() => setActiveStep(1)}>
            {t("General.previous")}
          </Button>
          <Button
            colorScheme={primaryColor}
            onClick={handleJoinServer}
            isLoading={isJoining}
            disabled={!serverPort || !isNameAvailable || isBotInGame}
          >
            {t("AgentJoinGameModal.steps.server.joinServer")}
          </Button>
        </ModalFooter>
      </>
    );
  }, [
    serverPort,
    primaryColor,
    isNameAvailable,
    botName,
    isBotInGame,
    botExitReason,
    modalProps.onClose,
    t,
    handleJoinServer,
    isJoining,
    setActiveStep,
  ]);

  const steps = useMemo(
    () => [
      {
        key: "player",
        content: step1Content,
        description: selectedPlayer?.name || "",
      },
      {
        key: "instance",
        content: step2Content,
        description: selectedInstance?.name || "",
      },
      {
        key: "server",
        content: step3Content,
        description: serverPort || "",
      },
    ],
    [
      selectedInstance?.name,
      selectedPlayer?.name,
      serverPort,
      step1Content,
      step2Content,
      step3Content,
    ]
  );

  return (
    <Modal
      scrollBehavior="inside"
      size={{ base: "2xl", lg: "3xl", xl: "4xl" }}
      {...modalProps}
    >
      <ModalOverlay />
      <ModalContent h="100%">
        <ModalHeader>{t("AgentJoinGameModal.header.title")}</ModalHeader>
        <ModalCloseButton />

        <Center>
          <Stepper
            colorScheme={primaryColor}
            index={activeStep}
            w="80%"
            my={1.5}
          >
            {steps.map((step, index) => (
              <Step key={index}>
                <StepIndicator>
                  <StepStatus
                    complete={<StepIcon />}
                    incomplete={<StepNumber />}
                    active={<StepNumber />}
                  />
                </StepIndicator>
                <Box flexShrink="0">
                  <StepTitle fontSize="sm">
                    {index === 0
                      ? t("AgentJoinGameModal.steps.player.title")
                      : index === 1
                        ? t("AgentJoinGameModal.steps.instance.title")
                        : t("AgentJoinGameModal.steps.server.title")}
                  </StepTitle>
                  <StepDescription fontSize="xs">
                    {index < activeStep && step.description}
                  </StepDescription>
                </Box>
                <StepSeparator />
              </Step>
            ))}
          </Stepper>
        </Center>

        <Flex flexGrow="1" flexDir="column" h="100%" overflow="auto">
          {steps[activeStep].content}
        </Flex>
      </ModalContent>
    </Modal>
  );
};

export default AgentJoinGameModal;
