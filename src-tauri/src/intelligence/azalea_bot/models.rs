use azalea::prelude::{Client, Component};
use serde::Serialize;
use std::sync::{atomic::AtomicBool, Arc};
use tauri::AppHandle;
use tokio::sync::Mutex;

#[derive(Clone, Component)]
pub struct BotState {
  pub client: Arc<Mutex<Option<Client>>>,
  pub app_handle: Option<AppHandle>,
  pub exit_notified: Arc<AtomicBool>,
}

impl Default for BotState {
  fn default() -> Self {
    Self {
      client: Arc::new(Mutex::new(None)),
      app_handle: None,
      exit_notified: Arc::new(AtomicBool::new(false)),
    }
  }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BotExitPayload {
  pub reason: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerPortPayload {
  pub port: String,
}
