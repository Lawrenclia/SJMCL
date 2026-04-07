use azalea::prelude::{Client, Component};
use serde::{Deserialize, Serialize};
use std::sync::{atomic::AtomicBool, Arc};
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[derive(Clone, Component)]
pub struct BotState {
  pub client: Arc<tokio::sync::Mutex<Option<Client>>>,
  pub app_handle: Option<AppHandle>,
  pub exit_notified: Arc<AtomicBool>,
  pub last_action_time: Arc<std::sync::Mutex<Instant>>,
  pub cooldown: Duration,
}

impl Default for BotState {
  fn default() -> Self {
    Self {
      client: Arc::new(tokio::sync::Mutex::new(None)),
      app_handle: None,
      exit_notified: Arc::new(AtomicBool::new(false)),
      last_action_time: Arc::new(std::sync::Mutex::new(Instant::now())),
      cooldown: Duration::from_secs(6),
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

#[derive(Serialize, Clone, Deserialize, Debug, PartialEq, Eq, Hash)]
pub struct AgentDecision {
  pub thought: String,
  pub action: ActionType,
  pub target_coords: Option<Coordinates>,
  pub target_entity_id: Option<u32>,
}

#[derive(Serialize, Clone, Deserialize, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
  Move,
  Mine,
  Attack,
  Wait,
}

#[derive(Serialize, Clone, Deserialize, Debug, PartialEq, Eq, Hash)]
pub struct Coordinates {
  pub x: i32,
  pub y: i32,
  pub z: i32,
}
