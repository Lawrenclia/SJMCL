use crate::account::helpers::offline::yggdrasil_server::YggdrasilServer;
use crate::account::models::{
  AccountError, PlayerInfo, PlayerType, SkinModel, Texture, TextureType,
};
use crate::error::SJMCLResult;
use crate::intelligence::azalea_bot::constants::BOT_EXIT_EVENT;
use crate::intelligence::azalea_bot::models::{BotExitPayload, BotState};
use crate::utils::fs::get_app_resource_filepath;
use crate::utils::image::load_image_from_dir;
use azalea::{prelude::*, Event};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

fn emit_bot_exit(app_handle: &AppHandle, notified: &AtomicBool, reason: &str) {
  if !notified.swap(true, Ordering::SeqCst) {
    if let Err(err) = app_handle.emit_to(
      "main",
      BOT_EXIT_EVENT,
      BotExitPayload {
        reason: reason.to_string(),
      },
    ) {
      log::warn!("Failed to emit bot exit event: {}", err);
    }
  }
}

pub async fn join_server(app_handle: &AppHandle, port: u16, name: String) -> SJMCLResult<()> {
  let client_ptr = {
    let binding = app_handle.state::<Mutex<BotState>>();
    let bot = binding.lock()?;
    bot.client.clone()
  };
  let old_bot = {
    let mut client_lock = client_ptr.lock().await;
    client_lock.take()
  };
  if let Some(bot) = old_bot {
    bot.exit();
  }
  let bot_state = BotState {
    client: client_ptr.clone(),
    app_handle: Some(app_handle.clone()),
    exit_notified: Arc::new(AtomicBool::new(false)),
  };
  let address = format!("localhost:{}", port);
  let account = Account::offline(name.as_str());
  {
    let local_ygg_server_state = app_handle.state::<Mutex<YggdrasilServer>>();
    let local_ygg_server = local_ygg_server_state.lock()?;
    let miuxi_skin_path = get_app_resource_filepath(app_handle, "assets/skins/miuxi.png")?;
    let miuxi_player_info = PlayerInfo {
      id: "".to_string(),
      name,
      uuid: account.uuid(),
      player_type: PlayerType::Offline,
      auth_account: None,
      auth_server_url: None,
      access_token: None,
      refresh_token: None,
      textures: vec![Texture {
        texture_type: TextureType::Skin,
        image: load_image_from_dir(&miuxi_skin_path)
          .ok_or(AccountError::TextureError)?
          .into(),
        model: SkinModel::Slim,
        preset: None,
      }],
    }
    .with_generated_id();
    local_ygg_server.apply_player(miuxi_player_info);
  }
  std::thread::spawn(move || {
    let rt = tokio::runtime::Builder::new_current_thread()
      .enable_all()
      .build()
      .expect("Could not create Tokio runtime");

    rt.block_on(async move {
      let app_exit = ClientBuilder::new()
        .set_handler(handle_events)
        .set_state(bot_state.clone())
        .start(account, address)
        .await;

      {
        let mut client_lock = bot_state.client.lock().await;
        *client_lock = None;
      }
      if let AppExit::Error(err) = app_exit {
        if let Some(app_handle) = &bot_state.app_handle {
          emit_bot_exit(
            app_handle,
            bot_state.exit_notified.as_ref(),
            err.to_string().as_str(),
          );
        }
      }

      log::info!("Bot has exited the server, cleaning up client state");
    });
  });

  Ok(())
}

async fn handle_events(bot: Client, event: Event, state: BotState) -> SJMCLResult<()> {
  let mut lock = state.client.lock().await;
  if lock.is_none() {
    *lock = Some(bot.clone());
    log::info!("Bot client stored in state");
  }
  drop(lock);

  match event {
    Event::Chat(m) => {
      log::info!("Received chat message: {}", m.message());
    }
    Event::Disconnect(_) => {
      log::info!("Bot disconnected from server");
      if let Some(app_handle) = &state.app_handle {
        emit_bot_exit(app_handle, state.exit_notified.as_ref(), "disconnect");
      }
      bot.exit();
    }
    Event::Death(_) => {
      log::info!("Bot has died in the game");
      if let Some(app_handle) = &state.app_handle {
        emit_bot_exit(app_handle, state.exit_notified.as_ref(), "death");
      }
      bot.exit();
    }
    Event::ConnectionFailed(_) => {
      log::info!("Bot failed to connect to server");
      if let Some(app_handle) = &state.app_handle {
        emit_bot_exit(
          app_handle,
          state.exit_notified.as_ref(),
          "connection_failed",
        );
      }
    }
    _ => {}
  }

  Ok(())
}
