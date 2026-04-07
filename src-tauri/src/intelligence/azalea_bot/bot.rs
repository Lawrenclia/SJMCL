use crate::account::helpers::offline::yggdrasil_server::YggdrasilServer;
use crate::account::models::{
  AccountError, PlayerInfo, PlayerType, SkinModel, Texture, TextureType,
};
use crate::error::SJMCLResult;
use crate::intelligence::azalea_bot::constants::BOT_EXIT_EVENT;
use crate::intelligence::azalea_bot::models::{
  ActionType, AgentDecision, BotExitPayload, BotState,
};
use crate::intelligence::models::ChatMessage;
use crate::utils::fs::get_app_resource_filepath;
use crate::utils::image::load_image_from_dir;
use azalea::pathfinder::goals::BlockPosGoal;
use azalea::{prelude::*, BlockPos, Event};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
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
    ..BotState::default()
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
    Event::Tick => {
      let mut last_act = state.last_action_time.lock()?;
      if last_act.elapsed() > state.cooldown {
        let observation = perceive_world_state(&bot);

        let state_clone = state.clone();
        let bot_clone = bot.clone();

        tokio::task::spawn_local(async move {
          if let Ok(decision) = query_llm_decision(&state_clone, &observation).await {
            execute_action(&bot_clone, decision).await;
          }
        });

        *last_act = Instant::now();
      }
    }
    Event::Chat(m) => {
      log::info!("Received chat message: {}", m.message());
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

fn perceive_world_state(bot: &Client) -> String {
  let position = bot.position();
  let block_pos = BlockPos::from(position);

  let mut observation = format!(
    "当前坐标: ({},{},{})\n",
    block_pos.x, block_pos.y, block_pos.z
  );

  // 1. 感知周边实体
  observation.push_str("附近的实体 (距离 < 10格):\n");
  // 利用谓词过滤所有的底层实体，提取具有坐标和合法类型的实体
  let nearby_entities =
    bot.nearest_entities_by::<&azalea_entity::Position, ()>(|_: &azalea_entity::Position| true);
  for entity in nearby_entities.iter().take(5) {
    let e_pos = entity.position();
    let dist = position.distance_to(e_pos);
    if dist > 0.1 && dist < 10.0 {
      observation.push_str(&format!(
        "- 实体ID {}: 距离 {:.1} 格\n",
        entity.id().index(),
        dist
      ));
    }
  }

  // 2. 感知具有战略价值的方块（以机器人为中心进行 5x5x5 扫描）
  observation.push_str("附近的方块:\n");
  let world_lock = bot.world();
  let instance = world_lock.read();

  let search_radius = 5;
  for x in -search_radius..=search_radius {
    for y in -search_radius..=search_radius {
      for z in -search_radius..=search_radius {
        let current_check_pos = block_pos.up(y).east(x).south(z);
        if let Some(state) = instance.get_block_state(current_check_pos) {
          let block_desc = format!("{:?}", state);
          // 启发式过滤：移除大量的无价值背景方块，节约 Token
          if !block_desc.contains("Air")
            && !block_desc.contains("Stone")
            && !block_desc.contains("Dirt")
          {
            observation.push_str(&format!(
              "- {}: ({},{},{})\n",
              block_desc, current_check_pos.x, current_check_pos.y, current_check_pos.z
            ));
          }
        }
      }
    }
  }

  observation
}

async fn execute_action(bot: &Client, decision: AgentDecision) {
  println!(">>> AI 思考: {}", decision.thought);

  match decision.action {
    ActionType::Move => {
      if let Some(coords) = decision.target_coords {
        println!(
          ">>> 执行: 寻路前往 [{}, {}, {}]",
          coords.x, coords.y, coords.z
        );
        let goal = BlockPosGoal(BlockPos::new(coords.x, coords.y, coords.z));
        // 使用底层 Baritone 算法的异步寻路启动器
        bot.start_goto(goal);
      }
    }
    ActionType::Mine => {
      if let Some(coords) = decision.target_coords {
        let pos = BlockPos::new(coords.x, coords.y, coords.z);
        println!(
          ">>> 执行: 自动匹配工具并挖掘方块 [{}, {}, {}]",
          pos.x, pos.y, pos.z
        );

        let bot_clone = bot.clone();
        // 将持续性的挖矿行为派发到局部异步队列，避免阻塞主循环
        tokio::task::spawn_local(async move {
          bot_clone.mine_with_auto_tool(pos).await;
        });
      }
    }
    ActionType::Attack => {
      // 在实际使用中，通过 ID 匹配 ECS 中的实体
      if let Some(target) =
        bot.nearest_entity_by::<&azalea_entity::Position, ()>(|_: &azalea_entity::Position| true)
      {
        // 模拟人类行为：先转动视角对准目标实体
        bot.look_at(target.position());

        // 校验武器攻击冷却，防止因高频攻击而触发反作弊断开连接
        if !bot.has_attack_cooldown() {
          bot.attack(target.id());
          println!(">>> 执行: 挥击并攻击了最近的实体");
        }
      }
    }
    ActionType::Wait => {
      println!(">>> 执行: 保持待机");
    }
  }
}

async fn query_llm_decision(state: &BotState, observation: &str) -> SJMCLResult<AgentDecision> {
  // 1. 构建系统提示词和用户输入，兼容不同 provider 的消息格式要求
  let system_prompt = "你是一个 Minecraft 游戏中的智能代理。输出必须是 JSON。";
  let user_prompt = format!(
    "当前环境观察如下：\n{}\n\n请基于以上观察，做出一个合理的行动决策。返回 JSON 字段：thought, action(move/mine/attack/wait), target_coords(可选), target_entity_id(可选)。不要输出 JSON 之外的内容。其中 move 指令能够让代理通过自动寻路到达指定的远处坐标，无需考虑路径规划细节；mine 指令能够让代理自动匹配工具并挖掘指定坐标的方块；attack 指令能够让代理攻击指定 ID 的实体；wait 指令能够让代理保持当前状态不动。作为探索者，你应该优先选择 move 来广泛探索远处环境，如寻找木头资源；当你发现有价值的方块时，使用 mine 来挖掘；当你感知到附近有敌对实体时，使用 attack 来攻击它；当你没有更好的选择时，尽量不要使用 wait。请基于当前的环境观察，做出一个合理的决策。",
    observation
  );

  let messages = vec![
    ChatMessage {
      role: "system".to_string(),
      content: system_prompt.to_string(),
    },
    ChatMessage {
      role: "user".to_string(),
      content: user_prompt,
    },
  ];

  // 2. 先请求 json_object；若 provider 不支持 response_format，再降级为不传该参数
  let response_format = serde_json::json!({ "type": "json_object" });
  let app = state.app_handle.as_ref().unwrap().clone();
  let llm_response = match crate::intelligence::commands::fetch_llm_chat_response(
    app.clone(),
    messages.clone(),
    Some(response_format),
  )
  .await
  {
    Ok(resp) => resp,
    Err(_) => crate::intelligence::commands::fetch_llm_chat_response(app, messages, None).await?,
  };

  // 3. 解析 LLM 响应为 AgentDecision
  let decision: AgentDecision = serde_json::from_str(&llm_response)
    .map_err(|_| crate::error::SJMCLError("Failed to parse LLM response".to_string()))?;

  Ok(decision)
}
