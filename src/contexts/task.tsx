import { ToastId, useToast as useChakraToast } from "@chakra-ui/react";
import { emit } from "@tauri-apps/api/event";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useLauncherConfig } from "@/contexts/config";
import { useGlobalData } from "@/contexts/global-data";
import { useSharedModals } from "@/contexts/shared-modal";
import { useToast } from "@/contexts/toast";
import { OtherResourceType } from "@/enums/resource";
import {
  CreatedPTaskEventStatus,
  FailedPTaskEventStatus,
  GTaskEventPayload,
  GTaskEventStatusEnums,
  InProgressPTaskEventStatus,
  PTaskEventPayload,
  PTaskEventStatusEnums,
  StartedPTaskEventStatus,
  TaskDesc,
  TaskDescStatusEnums,
  TaskGroupDesc,
  TaskParam,
} from "@/models/task";
import { ConfigService } from "@/services/config";
import {
  EXTENSION_REFRESH_EVENT,
  ExtensionService,
} from "@/services/extension";
import { InstanceService } from "@/services/instance";
import { RESOURCE_REFRESH_EVENT } from "@/services/resource";
import { TaskService } from "@/services/task";

// ---------------------------------------------------------------------------
// Pure task state helpers. React may invoke a state updater more than once
// (StrictMode), so updaters must never run side effects (toasts, service
// calls, modals). All derived group fields are recomputed here.
// ---------------------------------------------------------------------------

const computeGroupInfo = (group: TaskGroupDesc): TaskGroupDesc => {
  const taskDescs = group.taskDescs.map((desc) => ({ ...desc }));

  if (group.status === GTaskEventStatusEnums.Completed) {
    taskDescs.forEach((t) => {
      t.status = TaskDescStatusEnums.Completed;
      t.current = t.total; // Ensure current is set to total for completed tasks
    });
  }

  const finishedCount = taskDescs.filter(
    (t) => t.status === TaskDescStatusEnums.Completed
  ).length;

  const knownTotalArr = taskDescs.filter((t) => t.total && t.total > 0);
  const knownTotal = knownTotalArr.reduce((acc, t) => acc + t.total, 0);
  const knownCurrent = knownTotalArr.reduce(
    (acc, t) => acc + (t.current || 0),
    0
  );
  let estimatedTotal;
  if (knownTotalArr.length > 0) {
    estimatedTotal =
      knownTotal +
      (taskDescs.length - knownTotalArr.length) *
        (knownTotal / knownTotalArr.length); // Estimate unknown task's size based on known tasks' average size
  } else {
    estimatedTotal = knownTotal; // Fallback when no known tasks exist
  }

  let estimatedTime: TaskGroupDesc["estimatedTime"];
  taskDescs.forEach((t) => {
    if (t.status === TaskDescStatusEnums.InProgress && t.estimatedTime) {
      if (!estimatedTime || estimatedTime.secs < t.estimatedTime.secs) {
        estimatedTime = t.estimatedTime;
      }
    }
    t.progress = t.total ? (t.current * 100) / t.total : 0;
  });

  taskDescs.sort((a, b) => {
    let level = (desc: TaskDesc) => {
      switch (desc.status) {
        case TaskDescStatusEnums.Failed:
          return 0;
        case TaskDescStatusEnums.InProgress:
          return 1;
        case TaskDescStatusEnums.Waiting:
          return 2;
        case TaskDescStatusEnums.Completed:
          return 4;
        default:
          return 3;
      }
    };
    return level(a) - level(b);
  });

  return {
    ...group,
    taskDescs,
    finishedCount,
    progress: estimatedTotal ? (knownCurrent * 100) / estimatedTotal : 0,
    estimatedTime,
  };
};

const isActiveGroup = (t: TaskGroupDesc) =>
  t.status === GTaskEventStatusEnums.Started ||
  t.status === GTaskEventStatusEnums.Stopped;

const applyTaskEvent = (
  prevTasks: TaskGroupDesc[],
  payload: PTaskEventPayload
): TaskGroupDesc[] => {
  const index = prevTasks.findIndex((t) => t.taskGroup === payload.taskGroup);
  const group = index >= 0 ? prevTasks[index] : undefined;
  const replaceGroup = (next: TaskGroupDesc) =>
    prevTasks.map((task, i) => (i === index ? next : task));

  switch (payload.event.status) {
    case PTaskEventStatusEnums.Created: {
      const desc = (payload.event as CreatedPTaskEventStatus).desc;
      if (!group) {
        return [
          computeGroupInfo({
            status: GTaskEventStatusEnums.Started,
            taskGroup: payload.taskGroup,
            taskDescs: [desc],
          }),
          ...prevTasks,
        ];
      }

      let taskDescs: TaskDesc[];
      if (group.taskDescs.some((t) => t.taskId === payload.id)) {
        taskDescs = group.taskDescs;
      } else if (
        group.taskDescs.some((t) => t.payload.dest === desc.payload.dest)
      ) {
        // It's a retrial task emitted from the backend
        taskDescs = group.taskDescs.map((t) =>
          t.payload.dest === desc.payload.dest ? desc : t
        );
      } else {
        taskDescs = [desc, ...group.taskDescs];
      }
      return replaceGroup(computeGroupInfo({ ...group, taskDescs }));
    }

    case PTaskEventStatusEnums.Started: {
      if (!group) return prevTasks;
      return replaceGroup(
        computeGroupInfo({
          ...group,
          taskDescs: group.taskDescs.map((t) =>
            t.taskId === payload.id
              ? {
                  ...t,
                  status: TaskDescStatusEnums.InProgress,
                  total: (payload.event as StartedPTaskEventStatus).total,
                }
              : t
          ),
        })
      );
    }

    case PTaskEventStatusEnums.Completed: {
      if (!group) return prevTasks;
      return replaceGroup(
        computeGroupInfo({
          ...group,
          taskDescs: group.taskDescs.map((t) =>
            t.taskId === payload.id
              ? {
                  ...t,
                  status: TaskDescStatusEnums.Completed,
                  current: t.total,
                }
              : t
          ),
        })
      );
    }

    case PTaskEventStatusEnums.Stopped: {
      if (!group) return prevTasks;
      return replaceGroup(
        computeGroupInfo({
          ...group,
          taskDescs: group.taskDescs.map((t) =>
            t.taskId === payload.id
              ? { ...t, status: TaskDescStatusEnums.Stopped }
              : t
          ),
        })
      );
    }

    case PTaskEventStatusEnums.Cancelled: {
      if (!group) return prevTasks;
      return replaceGroup(
        computeGroupInfo({
          ...group,
          taskDescs: group.taskDescs.map((t) =>
            t.taskId === payload.id
              ? { ...t, status: TaskDescStatusEnums.Cancelled }
              : t
          ),
        })
      );
    }

    case PTaskEventStatusEnums.InProgress: {
      if (!group) return prevTasks;
      const event = payload.event as InProgressPTaskEventStatus;
      return replaceGroup(
        computeGroupInfo({
          ...group,
          taskDescs: group.taskDescs.map((t) =>
            t.taskId === payload.id
              ? {
                  ...t,
                  current: event.current,
                  status: TaskDescStatusEnums.InProgress,
                  estimatedTime: event.estimatedTime,
                  speed: event.speed,
                }
              : t
          ),
        })
      );
    }

    case PTaskEventStatusEnums.Failed: {
      if (!group) return prevTasks;
      const reason = (payload.event as FailedPTaskEventStatus).reason;
      return replaceGroup(
        computeGroupInfo({
          ...group,
          taskDescs: group.taskDescs.map((t) =>
            t.taskId === payload.id
              ? { ...t, status: TaskDescStatusEnums.Failed, reason }
              : t
          ),
        })
      );
    }

    default:
      return prevTasks;
  }
};

const applyGroupEvent = (
  prevTasks: TaskGroupDesc[],
  payload: GTaskEventPayload
): TaskGroupDesc[] => {
  const index = prevTasks.findIndex((t) => t.taskGroup === payload.taskGroup);
  if (index < 0) return prevTasks;

  const group = prevTasks[index];
  const taskDescs = group.taskDescs.map((t) => {
    if (
      payload.event === GTaskEventStatusEnums.Completed &&
      (t.status === TaskDescStatusEnums.Waiting ||
        t.status === TaskDescStatusEnums.InProgress)
    ) {
      return { ...t, status: TaskDescStatusEnums.Completed, current: t.total };
    }
    return t;
  });

  // A group that reports completion while one of its tasks failed is treated
  // as failed for UI purposes.
  const status =
    payload.event === GTaskEventStatusEnums.Completed &&
    taskDescs.some((t) => t.status === TaskDescStatusEnums.Failed)
      ? GTaskEventStatusEnums.Failed
      : payload.event;

  return prevTasks.map((task, i) =>
    i === index ? computeGroupInfo({ ...group, status, taskDescs }) : task
  );
};

interface TaskContextType {
  tasks: TaskGroupDesc[];
  generalPercent: number | undefined; // General progress percentage for all tasks
  handleScheduleProgressiveTaskGroup: (
    taskGroup: string,
    params: TaskParam[]
  ) => void;
  handleCancelProgressiveTaskGroup: (taskGroup: string) => void;
  handleStopProgressiveTaskGroup: (taskGroup: string) => void;
  handleResumeProgressiveTaskGroup: (taskGroup: string) => void;
  handleClearHistoryTaskGroups: () => void;
}

export const TaskContext = createContext<TaskContextType | undefined>(
  undefined
);

export const TaskContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const toast = useToast();
  const { close: closeToast } = useChakraToast();
  const { getInstanceList } = useGlobalData();
  const { config, getJavaInfos } = useLauncherConfig();
  const { openSharedModal, openGenericConfirmDialog } = useSharedModals();
  const [tasks, setTasks] = useState<TaskGroupDesc[]>([]);
  const [generalPercent, setGeneralPercent] = useState<number>();
  const { t } = useTranslation();
  const modLoaderLoadingToastRef = React.useRef<ToastId | null>(null);
  const optifineLoadingToastRef = React.useRef<ToastId | null>(null);
  // Snapshot of the latest tasks for event handlers that need to look a group
  // up without reading state inside a `setTasks` updater.
  const tasksRef = React.useRef<TaskGroupDesc[]>([]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const handleRetrieveProgressTasks = useCallback(() => {
    TaskService.retrieveProgressiveTaskList().then((response) => {
      if (response.status === "success") {
        logger.info("Retrieved progressive tasks:", response.data);
        setTasks((prevTasks) => {
          const merged = response.data
            .map(
              (group) =>
                prevTasks?.find((t) => t.taskGroup === group.taskGroup) ??
                computeGroupInfo(group)
            )
            .filter(
              (group) => group.status !== GTaskEventStatusEnums.Cancelled
            );
          merged.sort((a, b) => {
            let { timestamp: aTime } = parseTaskGroup(a.taskGroup);
            let { timestamp: bTime } = parseTaskGroup(b.taskGroup);
            return bTime - aTime; // Sort by timestamp descending
          });
          return merged;
        });
      } else {
        toast({
          title: response.message,
          description: response.details,
          status: "error",
        });
      }
    });
  }, [toast]);

  useEffect(() => {
    handleRetrieveProgressTasks();
  }, [handleRetrieveProgressTasks]);

  const handleScheduleProgressiveTaskGroup = useCallback(
    (taskGroup: string, params: TaskParam[]) => {
      TaskService.scheduleProgressiveTaskGroup(taskGroup, params).then(
        (response) => {
          // success toast will now be called by task context group listener
          if (response.status !== "success") {
            toast({
              title: response.message,
              description: response.details,
              status: "error",
            });
          }
        }
      );
    },
    [toast]
  );

  const handleCancelProgressiveTaskGroup = useCallback(
    (taskGroup: string) => {
      TaskService.cancelProgressiveTaskGroup(taskGroup).then((response) => {
        if (response.status !== "success") {
          toast({
            title: response.message,
            description: response.details,
            status: "error",
          });
        }
      });
    },
    [toast]
  );

  const handleStopProgressiveTaskGroup = useCallback(
    (taskGroup: string) => {
      TaskService.stopProgressiveTaskGroup(taskGroup).then((response) => {
        if (response.status !== "success") {
          toast({
            title: response.message,
            description: response.details,
            status: "error",
          });
        }
      });
    },
    [toast]
  );

  const handleResumeProgressiveTaskGroup = useCallback(
    (taskGroup: string) => {
      TaskService.resumeProgressiveTaskGroup(taskGroup).then((response) => {
        if (response.status !== "success") {
          toast({
            title: response.message,
            description: response.details,
            status: "error",
          });
        }
      });
    },
    [toast]
  );

  const handleClearHistoryTaskGroups = useCallback(() => {
    const remaining = tasksRef.current.filter(isActiveGroup);
    tasksRef.current
      .filter((t) => !isActiveGroup(t))
      .forEach((group) => {
        TaskService.deleteProgressiveTaskGroup(group.taskGroup);
      });
    setTasks(remaining);
  }, []);

  useEffect(() => {
    const unlisten = TaskService.onProgressiveTaskUpdate(
      (payload: PTaskEventPayload) => {
        if (payload.event.status === PTaskEventStatusEnums.Failed) {
          logger.error(
            `Task ${payload.id} failed in group ${payload.taskGroup}: ${
              (payload.event as FailedPTaskEventStatus).reason
            }`
          );
        }
        setTasks((prevTasks) => applyTaskEvent(prevTasks, payload));
      }
    );

    return () => {
      unlisten();
    };
  }, []);

  const runGroupSideEffects = useCallback(
    (
      payload: GTaskEventPayload,
      group: TaskGroupDesc | undefined,
      effectiveEvent: GTaskEventStatusEnums
    ) => {
      const { name, params } = parseTaskGroup(payload.taskGroup);

      toast({
        status:
          effectiveEvent === GTaskEventStatusEnums.Failed ? "error" : "success",
        title: t(`Services.task.onTaskGroupUpdate.status.${effectiveEvent}`, {
          param: t(`DownloadTasksPage.task.${name}`, params),
        }),
      });

      if (effectiveEvent !== GTaskEventStatusEnums.Completed) return;

      switch (name) {
        case "game-client":
        case "change-mod-loader":
        case "change-optifine":
          getInstanceList(true);
          break;
        case "game-client-w-java":
          getInstanceList(true);
          getJavaInfos(true);
          break;
        case "forge-libraries":
        case "cleanroom-libraries":
        case "neoforge-libraries":
        case "optifine-libraries": {
          const instanceId = params.param || params.param1;
          if (!instanceId) break;

          const isOptifine = name === "optifine-libraries";
          const loadingToastRef = isOptifine
            ? optifineLoadingToastRef
            : modLoaderLoadingToastRef;
          if (loadingToastRef.current) break;

          const instanceName = getInstanceList()?.find(
            (i) => i.id === instanceId
          )?.name;
          loadingToastRef.current = toast({
            title: t(
              isOptifine
                ? "Services.instance.finishOptiFineLoaderInstall.loading"
                : "Services.instance.finishModLoaderInstall.loading",
              { instanceName }
            ),
            status: "loading",
          });

          const finishRequest = isOptifine
            ? InstanceService.finishOptiFineLoaderInstall(instanceId)
            : InstanceService.finishModLoaderInstall(instanceId);
          finishRequest.then((response) => {
            if (loadingToastRef.current) {
              closeToast(loadingToastRef.current);
              loadingToastRef.current = null;
            }
            if (response.status === "success") {
              getInstanceList(true);
              toast({
                title: response.message,
                status: "success",
              });
            } else {
              toast({
                title: response.message,
                description: response.details,
                status: "error",
              });
            }
          });
          break;
        }
        case "mod":
        case "mod-update":
          emit(RESOURCE_REFRESH_EVENT, OtherResourceType.Mod);
          break;
        case "resourcepack":
          emit(RESOURCE_REFRESH_EVENT, OtherResourceType.ResourcePack);
          break;
        case "shader":
          emit(RESOURCE_REFRESH_EVENT, OtherResourceType.ShaderPack);
          break;
        case "modpack": {
          const taskDesc = group?.taskDescs[0];
          if (taskDesc) {
            openSharedModal("import-modpack", {
              path: taskDesc.payload.dest,
            });
          }
          break;
        }
        case "launcher-update": {
          const filename = group?.taskDescs[0]?.payload.filename || "";
          const isWinInstaller =
            config.basicInfo.osType === "windows" &&
            !config.basicInfo.isPortable;
          openGenericConfirmDialog({
            title: t("RestartForUpdateConfirmDialog.title"),
            body: t(
              `RestartForUpdateConfirmDialog.${isWinInstaller ? "bodyWinInstaller" : "body"}`
            ),
            btnOK: t(
              `RestartForUpdateConfirmDialog.button.${isWinInstaller ? "install" : "restart"}`
            ),
            btnCancel: t("RestartForUpdateConfirmDialog.button.later"),
            onOKCallback: () => {
              ConfigService.installLauncherUpdate(filename, true).then(
                (response) => {
                  if (response.status !== "success") {
                    toast({
                      title: response.message,
                      description: response.details,
                      status: "error",
                    });
                  }
                }
              );
            },
            onCancelCallback: () => {
              ConfigService.installLauncherUpdate(filename, false).then(
                (response) => {
                  if (response.status !== "success") {
                    toast({
                      title: response.message,
                      description: response.details,
                      status: "error",
                    });
                  }
                }
              );
            },
          });
          break;
        }
        case "extension-update": {
          const task = group?.taskDescs[0];
          const expectedIdentifier = params.param1;
          const newVersion = params.param2 || "";

          if (task && expectedIdentifier) {
            openGenericConfirmDialog({
              title: t("ExtensionUpdateConfirmDialog.title"),
              body: t("ExtensionUpdateConfirmDialog.body", {
                identifier: expectedIdentifier,
                version: newVersion,
                src: task.payload.src,
              }),
              onOKCallback: () => {
                ExtensionService.addExtension(
                  task.payload.dest,
                  expectedIdentifier
                ).then((response) => {
                  if (response.status === "success") {
                    toast({
                      title: response.message,
                      status: "success",
                    });
                    emit(EXTENSION_REFRESH_EVENT);
                  } else {
                    toast({
                      title: response.message,
                      description: response.details,
                      status: "error",
                    });
                  }
                });
              },
            });
          }
          break;
        }
        case "mojang-java":
          getJavaInfos(true);
          break;
        default:
          break;
      }
    },
    [
      t,
      toast,
      closeToast,
      getInstanceList,
      getJavaInfos,
      openSharedModal,
      openGenericConfirmDialog,
      config.basicInfo.osType,
      config.basicInfo.isPortable,
    ]
  );

  useEffect(() => {
    const unlisten = TaskService.onTaskGroupUpdate(
      (payload: GTaskEventPayload) => {
        logger.info(`Received task group update: ${payload.event}`);

        const group = tasksRef.current.find(
          (t) => t.taskGroup === payload.taskGroup
        );
        // A group that reports completion while one of its tasks failed is
        // treated as failed for UI purposes.
        const effectiveEvent =
          payload.event === GTaskEventStatusEnums.Completed &&
          group?.taskDescs.some((t) => t.status === TaskDescStatusEnums.Failed)
            ? GTaskEventStatusEnums.Failed
            : payload.event;

        setTasks((prevTasks) => applyGroupEvent(prevTasks, payload));
        runGroupSideEffects(payload, group, effectiveEvent);
      }
    );

    return () => {
      unlisten();
    };
  }, [runGroupSideEffects]);

  useEffect(() => {
    if (!tasks || !tasks.length) setGeneralPercent(undefined);
    else {
      let filteredTasks = tasks.filter(
        (t) => t.status === GTaskEventStatusEnums.Started
      );

      if (filteredTasks.length === 0) setGeneralPercent(undefined);
      else {
        setGeneralPercent(
          filteredTasks.reduce(
            (acc, group) => acc + (group.progress ?? 0) / filteredTasks.length,
            0
          )
        );
      }
    }
  }, [tasks]);

  return (
    <TaskContext.Provider
      value={{
        tasks,
        generalPercent,
        handleScheduleProgressiveTaskGroup,
        handleCancelProgressiveTaskGroup,
        handleStopProgressiveTaskGroup,
        handleResumeProgressiveTaskGroup,
        handleClearHistoryTaskGroups,
      }}
    >
      {children}
    </TaskContext.Provider>
  );
};

export const useTaskContext = (): TaskContextType => {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error("useTaskContext must be used within a TaskContextProvider");
  }
  return context;
};

export const parseTaskGroup = (
  taskGroup: string
): {
  name: string;
  params: Record<string, string>;
  timestamp: number;
  isRetry: boolean;
  rawName: string;
} => {
  const lastAtIndex = taskGroup.lastIndexOf("@");
  let rawName: string;
  let timestamp: number;

  if (lastAtIndex === -1) {
    rawName = taskGroup;
    timestamp = Date.now();
  } else {
    rawName = taskGroup.substring(0, lastAtIndex);
    timestamp = parseInt(taskGroup.substring(lastAtIndex + 1));
  }

  const [name, paramString] = rawName.split("?");
  const params = paramString ? paramString.split("&") : [];

  return {
    name: name.replace(/^retry-/, ""),
    params:
      params.length === 1
        ? { param: params[0] }
        : Object.fromEntries(
            params.map((param, index) => [`param${index + 1}`, param])
          ),
    isRetry: name.startsWith("retry-"),
    timestamp: timestamp,
    rawName,
  };
};
