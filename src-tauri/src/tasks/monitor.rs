use async_speed_limit::Limiter;
use flume::{Receiver as FlumeReceiver, Sender as FlumeSender};
use glob::glob;
use log::info;
use sjmcl_types::error::SJMCLResult;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::vec::Vec;
use tauri::AppHandle;
use tauri::Manager;
use tauri::async_runtime::JoinHandle;
use tokio::sync::Semaphore;

use crate::launcher_config::commands::retrieve_launcher_config;
use crate::tasks::download::{DownloadTask, descriptors_dir, part_path_for};
use crate::tasks::events::{GEvent, GEventStatus, PEvent, TEvent};
use crate::tasks::streams::desc::PStatus;
use crate::tasks::{SJMCLBoxedFuture, SJMCLFuture, *};

pub struct GroupMonitor {
  pub phs: HashMap<u32, Arc<RwLock<PTaskHandle>>>,
  pub status: GEventStatus,
}

/// Callback executed once a whole task group finishes.
///
/// Successful groups run `on_success` hooks (finalize instance/loader config,
/// remove superseded files, ...); failed groups run `on_failure` hooks.
pub type GroupHook =
  Box<dyn FnOnce(AppHandle) -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + 'static>;

#[derive(Default)]
pub struct GroupHooks {
  pub on_success: Vec<GroupHook>,
  pub on_failure: Vec<GroupHook>,
}

/// Convenience wrapper turning an async closure into a [`GroupHook`].
pub fn make_group_hook<F, Fut>(callback: F) -> GroupHook
where
  F: FnOnce(AppHandle) -> Fut + Send + 'static,
  Fut: Future<Output = ()> + Send + 'static,
{
  Box::new(move |app| Box::pin(callback(app)))
}

async fn run_group_hooks(
  hooks: &Arc<Mutex<HashMap<String, GroupHooks>>>,
  app: &AppHandle,
  task_group: &str,
  success: bool,
) {
  let Some(mut group_hooks) = hooks.lock().unwrap().remove(task_group) else {
    return;
  };
  let callbacks = if success {
    std::mem::take(&mut group_hooks.on_success)
  } else {
    std::mem::take(&mut group_hooks.on_failure)
  };
  for callback in callbacks {
    callback(app.clone()).await;
  }
}

/// Mark a task as cancelled, drop its persisted descriptor and the partial
/// file so a cancelled download does not leave orphans behind.
fn cancel_task_handle(app: &AppHandle, handle: &Arc<RwLock<PTaskHandle>>) {
  let payload = {
    let mut handle = handle.write().unwrap();
    handle.mark_cancelled();
    handle.desc.payload.clone()
  };
  TaskMonitor::remove_terminal_descriptor(handle);
  let PTaskParam::Download(param) = &payload;
  crate::tasks::download::cleanup_part(app, param);
}

pub struct TaskMonitor {
  app_handle: AppHandle,
  id_counter: AtomicU32,
  phs: RwLock<HashMap<u32, Arc<RwLock<PTaskHandle>>>>,
  ths: RwLock<HashMap<u32, THandle>>,
  tasks: Arc<Mutex<HashMap<u32, JoinHandle<()>>>>,
  concurrency: Arc<Semaphore>,
  tx: FlumeSender<SJMCLFuture>,
  rx: FlumeReceiver<SJMCLFuture>,
  group_map: Arc<RwLock<HashMap<String, GroupMonitor>>>,
  stopped_futures: Arc<Mutex<Vec<SJMCLFuture>>>,
  group_hooks: Arc<Mutex<HashMap<String, GroupHooks>>>,
  pub download_rate_limiter: Option<Limiter>,
}

impl TaskMonitor {
  pub fn new(app_handle: AppHandle) -> Self {
    let config = retrieve_launcher_config(app_handle.clone()).unwrap();
    let (tx, rx) = flume::unbounded();
    TaskMonitor {
      app_handle: app_handle.clone(),
      id_counter: AtomicU32::new(0),
      phs: RwLock::new(HashMap::new()),
      ths: RwLock::new(HashMap::new()),
      tasks: Arc::new(Mutex::new(HashMap::new())),
      concurrency: Arc::new(Semaphore::new(
        if config.download.transmission.auto_concurrent {
          std::thread::available_parallelism().unwrap().into()
        } else {
          config.download.transmission.concurrent_count
        },
      )),
      tx,
      rx,
      group_map: Arc::new(RwLock::new(HashMap::new())),
      stopped_futures: Arc::new(Mutex::new(Vec::new())),
      group_hooks: Arc::new(Mutex::new(HashMap::new())),
      download_rate_limiter: if config.download.transmission.enable_speed_limit {
        Some(Limiter::new(
          (config.download.transmission.speed_limit_value as i64 * 1024) as f64,
        ))
      } else {
        None
      },
    }
  }

  /// Restore unfinished tasks persisted by a previous run.
  ///
  /// Descriptors are stored next to the download cache as
  /// `descriptors/task_{id}.json`. Terminal tasks are cleaned up, the task id
  /// counter is advanced past every restored id, and all pending downloads are
  /// re-enqueued (their `.part` files let the transfer resume).
  pub async fn load_saved_tasks(&self) {
    let cache_dir = retrieve_launcher_config(self.app_handle.clone())
      .unwrap()
      .download
      .cache
      .directory;
    let pattern = format!(
      "{}/task_*.json",
      descriptors_dir(&cache_dir).to_string_lossy()
    );

    let mut restored: Vec<PTaskDesc> = Vec::new();
    let mut max_task_id = 0u32;

    if let Ok(entries) = glob(&pattern) {
      for entry in entries.flatten() {
        match PTaskDesc::load(&entry) {
          Ok(desc) => {
            if matches!(
              desc.status,
              PStatus::Completed | PStatus::Cancelled | PStatus::Failed
            ) {
              let _ = std::fs::remove_file(&entry);
              continue;
            }
            max_task_id = max_task_id.max(desc.task_id);
            restored.push(desc);
          }
          Err(_) => info!("Failed to load task descriptor: {}", entry.display()),
        }
      }
    }

    self
      .id_counter
      .store(max_task_id.saturating_add(1), Ordering::SeqCst);

    // Partial files of unfinished tasks are kept for resume; every other
    // `*.part` file (cancelled/failed/aborted runs) is garbage.
    let active_parts: std::collections::HashSet<std::path::PathBuf> = restored
      .iter()
      .filter_map(|desc| match &desc.payload {
        PTaskParam::Download(param) => Some(part_path_for(&cache_dir.join(&param.dest))),
      })
      .collect();

    for desc in restored {
      let task_id = desc.task_id;
      let task_group = desc.task_group.clone();
      let task =
        DownloadTask::from_descriptor(self.app_handle.clone(), desc, Duration::from_secs(1), false);
      match task
        .future(self.app_handle.clone(), self.download_rate_limiter.clone())
        .await
      {
        Ok((future, handle)) => {
          self.enqueue_task(task_id, task_group, future, handle).await;
        }
        Err(error) => info!("Failed to restore task {task_id}: {error:?}"),
      }
    }

    let part_pattern = format!("{}/**/*.part", cache_dir.to_string_lossy());
    if let Ok(entries) = glob(&part_pattern) {
      for entry in entries.flatten() {
        if !active_parts.contains(&entry) {
          let _ = std::fs::remove_file(&entry);
        }
      }
    }
  }

  pub fn get_new_id(&self) -> u32 {
    self.id_counter.fetch_add(1, Ordering::SeqCst)
  }

  /// Register callbacks that run once the whole group reaches a terminal state.
  /// Callers must register before the group is enqueued, otherwise an instantly
  /// completed group (e.g. an already-downloaded file) could close before the
  /// hooks are installed.
  pub fn set_group_hooks(&self, task_group: &str, hooks: GroupHooks) {
    self
      .group_hooks
      .lock()
      .unwrap()
      .insert(task_group.to_string(), hooks);
  }

  /// Drop the persisted descriptor of a task once it reached a terminal state.
  fn remove_terminal_descriptor(handle: &Arc<RwLock<PTaskHandle>>) {
    let path = {
      let handle = handle.read().unwrap();
      if matches!(
        handle.desc.status,
        PStatus::Completed | PStatus::Cancelled | PStatus::Failed
      ) {
        Some(handle.path.clone())
      } else {
        None
      }
    };
    if let Some(path) = path {
      let _ = std::fs::remove_file(path);
    }
  }

  /// Wrap a task future so that failures are both reported on the task and
  /// propagated to the scheduler (needed for group-level failure handling).
  fn wrap_task_future<T>(task: T, p_handle: Arc<RwLock<PTaskHandle>>) -> SJMCLBoxedFuture
  where
    T: Future<Output = SJMCLResult<()>> + Send + 'static,
  {
    Box::pin(async move {
      if p_handle.read().unwrap().desc.status.is_cancelled() {
        return Ok(());
      }

      match task.await {
        Ok(()) => {
          Self::remove_terminal_descriptor(&p_handle);
          Ok(())
        }
        Err(error) => {
          p_handle.write().unwrap().mark_failed(error.0.clone());
          Self::remove_terminal_descriptor(&p_handle);
          Err(error)
        }
      }
    })
  }

  pub async fn enqueue_task<T>(
    &self,
    id: u32,
    task_group: Option<String>,
    task: T,
    p_handle: Arc<RwLock<PTaskHandle>>,
  ) where
    T: Future<Output = SJMCLResult<()>> + Send + 'static,
  {
    p_handle.write().unwrap().desc.status = PStatus::Waiting;
    self.phs.write().unwrap().insert(id, p_handle.clone());

    if let Some(ref group) = task_group {
      let mut group_map = self.group_map.write().unwrap();
      if let Some(group) = group_map.get_mut(group) {
        group.phs.insert(id, p_handle.clone());
      } else {
        group_map.insert(
          group.clone(),
          GroupMonitor {
            phs: HashMap::from_iter([(id, p_handle.clone())]),
            status: GEventStatus::Started,
          },
        );
      }
    }

    PEvent::emit_created(
      &self.app_handle,
      id,
      task_group.as_deref(),
      p_handle.read().unwrap().desc.clone(),
    );

    if let Some(ref task_group) = task_group {
      GEvent::emit_group_started(&self.app_handle, task_group);
    }

    let task = Self::wrap_task_future(task, p_handle);
    self
      .tx
      .send_async(SJMCLFuture {
        task_id: id,
        task_group,
        f: task,
      })
      .await
      .unwrap();
  }

  pub async fn enqueue_task_group(&self, task_group: String, futures: Vec<SJMCLFutureDesc>) {
    let mut hvec: Vec<(u32, Arc<RwLock<PTaskHandle>>)> = Vec::new();

    for future in futures.iter() {
      future.h.write().unwrap().desc.status = PStatus::Waiting;
      self
        .phs
        .write()
        .unwrap()
        .insert(future.task_id, future.h.clone());
      PEvent::emit_created(
        &self.app_handle,
        future.task_id,
        Some(task_group.as_ref()),
        future.h.read().unwrap().desc.clone(),
      );
      hvec.push((future.task_id, future.h.clone()));
    }

    self.group_map.write().unwrap().insert(
      task_group.clone(),
      GroupMonitor {
        phs: HashMap::from_iter(hvec),
        status: GEventStatus::Started,
      },
    );
    GEvent::emit_group_started(&self.app_handle, &task_group);

    for future in futures {
      let task = Self::wrap_task_future(future.f, future.h.clone());
      self
        .tx
        .send_async(SJMCLFuture {
          task_id: future.task_id,
          task_group: Some(task_group.clone()),
          f: task,
        })
        .await
        .unwrap();
    }
  }

  pub async fn background_process(&self) {
    loop {
      let future = self.rx.recv_async().await.unwrap();

      let is_cancelled = self
        .phs
        .read()
        .unwrap()
        .get(&future.task_id)
        .map(|handle| handle.read().unwrap().desc.status.is_cancelled())
        .unwrap_or(false);
      if is_cancelled {
        continue;
      }

      // Check if the task group is stopped before acquiring a permit.
      if let Some(ref task_group) = future.task_group {
        let is_stopped = self
          .group_map
          .read()
          .unwrap()
          .get(task_group)
          .map(|group| group.status == GEventStatus::Stopped)
          .unwrap_or(false);

        if is_stopped {
          self.stopped_futures.lock().unwrap().push(future);
          continue;
        }
      }

      let tasks = self.tasks.clone();
      let group_map = self.group_map.clone();
      let stopped_futures = self.stopped_futures.clone();
      let group_hooks = self.group_hooks.clone();
      let concurrency = self.concurrency.clone();
      let app = self.app_handle.clone();

      self.tasks.lock().unwrap().insert(
        future.task_id,
        tauri::async_runtime::spawn(async move {
          let task_id = future.task_id;
          let task_group = future.task_group.clone();

          // Wait for the task group to be resumed before taking a transfer
          // slot, so a paused group never starves other groups.
          if let Some(task_group) = task_group.clone() {
            loop {
              let is_stopped = group_map
                .read()
                .unwrap()
                .get(&task_group)
                .map(|group| group.status == GEventStatus::Stopped)
                .unwrap_or(false);
              if !is_stopped {
                break;
              }
              tokio::time::sleep(Duration::from_secs(1)).await;
            }
          }

          let permit = concurrency.clone().acquire_owned().await.unwrap();
          let result = future.f.await;
          drop(permit);

          match result {
            Ok(()) => {
              if let Some(group_name) = task_group {
                let completed = {
                  let mut groups = group_map.write().unwrap();
                  match groups.get_mut(&group_name) {
                    Some(group) => {
                      group.phs.remove(&task_id);
                      if group.phs.is_empty() && group.status != GEventStatus::Failed {
                        group.status = GEventStatus::Completed;
                        true
                      } else {
                        false
                      }
                    }
                    None => false,
                  }
                };

                if completed {
                  // Finalize group state (instance/loader config, cleanup of
                  // superseded files, ...) before notifying the frontend.
                  run_group_hooks(&group_hooks, &app, &group_name, true).await;
                  GEvent::emit_group_completed(&app, &group_name);
                }
              }
            }
            Err(error) => {
              info!("Task failed: {error:?}");
              if let Some(group_name) = task_group {
                let mut aborted = Vec::new();
                let mut cancelled_handles = Vec::new();
                let failed = {
                  let mut groups = group_map.write().unwrap();
                  match groups.get_mut(&group_name) {
                    Some(group) => {
                      group.status = GEventStatus::Failed;
                      group.phs.remove(&task_id);
                      for (id, handle) in group.phs.drain() {
                        cancelled_handles.push(handle);
                        aborted.push(id);
                      }
                      true
                    }
                    None => false,
                  }
                };

                if failed {
                  for handle in cancelled_handles {
                    cancel_task_handle(&app, &handle);
                  }
                  run_group_hooks(&group_hooks, &app, &group_name, false).await;
                  GEvent::emit_group_failed(&app, &group_name);
                }

                for id in aborted {
                  if let Some(join_handle) = tasks.lock().unwrap().remove(&id) {
                    join_handle.abort();
                  }
                }

                // Drop futures of this group that are still waiting to be dispatched.
                stopped_futures
                  .lock()
                  .unwrap()
                  .retain(|queued| queued.task_group.as_deref() != Some(group_name.as_str()));
              }
            }
          }

          tasks.lock().unwrap().remove(&task_id);
        }),
      );
    }
  }

  pub fn stop_progress(&self, id: u32) {
    if let Some(handle) = self.phs.read().unwrap().get(&id) {
      handle.write().unwrap().mark_stopped();
    }
  }

  pub fn resume_progress(&self, id: u32) {
    if let Some(handle) = self.phs.read().unwrap().get(&id) {
      handle.write().unwrap().mark_resumed();
    }
  }

  pub fn cancel_progress(&self, id: u32) {
    if let Some(p_handle) = self.phs.read().unwrap().get(&id).cloned() {
      cancel_task_handle(&self.app_handle, &p_handle);
    }

    if let Some(j_handle) = self.tasks.lock().unwrap().remove(&id) {
      j_handle.abort();
    }
  }

  pub async fn restart_progress(&self, id: u32) {
    let Some(handle) = self.phs.write().unwrap().remove(&id) else {
      return;
    };

    let desc = handle.read().unwrap().desc.clone();
    let task_group = desc.task_group.clone();
    let was_completed = desc.status.is_completed();

    if let Some(j_handle) = self.tasks.lock().unwrap().remove(&id)
      && !was_completed
    {
      j_handle.abort();
    }
    if !was_completed {
      handle.write().unwrap().mark_cancelled();
    }

    match desc.payload {
      PTaskParam::Download(_) => {
        let task = DownloadTask::from_descriptor(
          self.app_handle.clone(),
          desc,
          Duration::from_secs(1),
          true,
        );
        if let Ok((future, new_handle)) = task
          .future(self.app_handle.clone(), self.download_rate_limiter.clone())
          .await
        {
          self.enqueue_task(id, task_group, future, new_handle).await;
        }
      }
    }
  }

  pub fn create_transient_task(&self, app: AppHandle, mut handle: THandle) {
    handle.task_id = self.get_new_id();
    TEvent::new(&handle).emit(&app);
    self.ths.write().unwrap().insert(handle.task_id, handle);
  }

  pub fn set_transient_task(&self, app: AppHandle, task_id: u32, state: String) {
    if let Some(desc) = self.ths.write().unwrap().get_mut(&task_id) {
      desc.state = state;
      TEvent::new(desc).emit(&app);
    }
  }

  pub fn cancel_transient_task(&self, task_id: u32) {
    self.ths.write().unwrap().remove(&task_id);
  }

  pub fn get_transient_task(&self, task_id: u32) -> Option<THandle> {
    self.ths.read().unwrap().get(&task_id).cloned()
  }

  pub fn cancel_progressive_task_group(&self, task_group: String) {
    if let Some(group) = self.group_map.write().unwrap().remove(&task_group) {
      self.group_hooks.lock().unwrap().remove(&task_group);
      for handle in group.phs.values() {
        cancel_task_handle(&self.app_handle, handle);
        if let Some(join_handle) = self
          .tasks
          .lock()
          .unwrap()
          .remove(&handle.read().unwrap().desc.task_id)
        {
          join_handle.abort();
        }
      }
      self
        .stopped_futures
        .lock()
        .unwrap()
        .retain(|queued| queued.task_group.as_deref() != Some(task_group.as_str()));
      GEvent::emit_group_cancelled(&self.app_handle, &task_group);
    }
  }

  pub fn stop_progressive_task_group(&self, task_group: String) {
    if let Some(group) = self.group_map.write().unwrap().get_mut(&task_group) {
      group.status = GEventStatus::Stopped;
      for handle in group.phs.values() {
        let status = handle.read().unwrap().desc.status.clone();
        if status.is_in_progress() || status.is_waiting() {
          handle.write().unwrap().mark_stopped();
        }
      }
      GEvent::emit_group_stopped(&self.app_handle, &task_group);
    }
  }

  pub async fn resume_progressive_task_group(&self, task_group: String) {
    if let Some(group) = self.group_map.write().unwrap().get_mut(&task_group) {
      group.status = GEventStatus::Started;

      // Resume existing stopped tasks
      for handle in group.phs.values() {
        if handle.read().unwrap().desc.status.is_stopped() {
          handle.write().unwrap().mark_resumed();
        }
      }
    }

    // Re-send all stored stopped futures for this task group
    let futures_to_resend = {
      let mut stopped_futures = self.stopped_futures.lock().unwrap();
      let mut futures = Vec::new();

      let mut i = 0;
      while i < stopped_futures.len() {
        if stopped_futures[i].task_group.as_ref() == Some(&task_group) {
          futures.push(stopped_futures.remove(i));
        } else {
          i += 1;
        }
      }

      futures
    };

    for future in futures_to_resend {
      self.tx.send_async(future).await.unwrap();
    }

    GEvent::emit_group_started(&self.app_handle, &task_group);
  }

  pub fn delete_progressive_task_group(&self, task_group: String) {
    let mut group_map = self.group_map.write().unwrap();
    if let Some(group) = group_map.get(&task_group) {
      // Only delete non-active groups (not Started/Stopped); backend status is authoritative for race-condition protection.
      if group.status != GEventStatus::Started && group.status != GEventStatus::Stopped {
        group_map.remove(&task_group);
        self.group_hooks.lock().unwrap().remove(&task_group);
      }
    }
  }

  /// Whether a group whose name starts with `prefix` is still active
  /// (Started or Stopped). Used to avoid scheduling the same downloads twice
  /// when an instance is refreshed repeatedly.
  pub fn has_active_group_with_prefix(&self, prefix: &str) -> bool {
    self.group_map.read().unwrap().iter().any(|(name, group)| {
      name.starts_with(prefix)
        && matches!(group.status, GEventStatus::Started | GEventStatus::Stopped)
    })
  }
  pub fn state_list(&self) -> Vec<PTaskGroupDesc> {
    self
      .group_map
      .read()
      .unwrap()
      .iter()
      .map(|(k, v)| PTaskGroupDesc {
        task_group: k.clone(),
        task_descs: v
          .phs
          .values()
          .map(|h| h.read().unwrap().desc.clone())
          .collect(),
        status: v.status.clone(),
      })
      .collect()
  }

  pub fn has_active_download_tasks(&self) -> bool {
    let phs = self.phs.read().unwrap();
    for handle in phs.values() {
      let desc = handle.read().unwrap();
      let status = &desc.desc.status;
      // check if the task is a download task and is in progress or waiting
      if matches!(desc.desc.payload, PTaskParam::Download(_))
        && (status.is_in_progress() || status.is_waiting())
      {
        return true;
      }
    }
    false
  }
}

/// Convenience wrapper for call sites that only have an [`AppHandle`].
pub fn has_active_group(app: &AppHandle, prefix: &str) -> bool {
  app
    .try_state::<Pin<Box<TaskMonitor>>>()
    .map(|monitor| monitor.has_active_group_with_prefix(prefix))
    .unwrap_or(false)
}
