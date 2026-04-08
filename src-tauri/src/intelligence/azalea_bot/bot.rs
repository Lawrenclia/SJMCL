use crate::account::helpers::offline::yggdrasil_server::YggdrasilServer;
use crate::account::models::{
  AccountError, PlayerInfo, PlayerType, SkinModel, Texture, TextureType,
};
use crate::error::SJMCLResult;
use crate::intelligence::azalea_bot::constants::BOT_EXIT_EVENT;
use crate::intelligence::azalea_bot::models::{
  ActionType, AgentDecision, AgentState, BotExitPayload,
};
use crate::intelligence::models::ChatMessage;
use crate::utils::fs::get_app_resource_filepath;
use crate::utils::image::load_image_from_dir;
use azalea::inventory::ItemStack;
use azalea::pathfinder::goals::BlockPosGoal;
use azalea::player::GameProfileComponent;
use azalea::{prelude::*, BlockPos, Event};
use azalea_entity::metadata::Player;
use bevy_ecs::query::With;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use strum::IntoEnumIterator;
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
    let binding = app_handle.state::<Mutex<AgentState>>();
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
  let bot_state = AgentState {
    client: client_ptr.clone(),
    app_handle: Some(app_handle.clone()),
    ..AgentState::default()
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

fn schedule_decision(bot: &Client, state: &AgentState) -> SJMCLResult<()> {
  if state
    .decision_in_progress
    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
    .is_err()
  {
    return Ok(());
  }

  let mut observation = perceive_world_state(bot);

  let mut chats = state.recent_chats.lock()?;
  if !chats.is_empty() {
    observation.push_str("\n【最近的对话交流】:\n");
    for chat in chats.iter() {
      observation.push_str(&format!("- {}\n", chat));
    }
    chats.clear();
  }
  drop(chats);

  let state_clone = state.clone();
  let bot_clone = bot.clone();

  tokio::task::spawn_local(async move {
    if let Ok(decision) = query_llm_decision(&state_clone, &observation).await {
      execute_action(&bot_clone, decision).await;
    }

    if let Ok(mut last_act) = state_clone.last_action_time.lock() {
      *last_act = Instant::now();
    }

    let has_pending_chats = state_clone
      .recent_chats
      .lock()
      .map(|chats| !chats.is_empty())
      .unwrap_or(false);
    state_clone
      .pending_chat_priority
      .store(has_pending_chats, Ordering::SeqCst);
    state_clone
      .decision_in_progress
      .store(false, Ordering::SeqCst);
  });

  Ok(())
}

async fn handle_events(bot: Client, event: Event, state: AgentState) -> SJMCLResult<()> {
  let mut lock = state.client.lock().await;
  if lock.is_none() {
    *lock = Some(bot.clone());
    log::info!("Bot client stored in state");
  }
  drop(lock);

  match event {
    Event::Tick => {
      let cooldown_ready = state.last_action_time.lock()?.elapsed() > state.cooldown;
      let chat_priority = state.pending_chat_priority.load(Ordering::SeqCst);

      if cooldown_ready || chat_priority {
        schedule_decision(&bot, &state)?;
      }
    }
    Event::Chat(m) => {
      if let (Some(sender), content) = m.split_sender_and_content() {
        if sender != bot.profile().name
          && content
            .to_ascii_lowercase()
            .contains(bot.profile().name.to_ascii_lowercase().as_str())
        {
          let mut chats = state.recent_chats.lock()?;
          chats.push(format!("玩家 {} 刚刚对你说: {}", sender, content));
          drop(chats);
          state.pending_chat_priority.store(true, Ordering::SeqCst);
          schedule_decision(&bot, &state)?;
        }
      }
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
    Event::Disconnect(_) => {
      log::info!("Bot was disconnected from server");
      if let Some(app_handle) = &state.app_handle {
        emit_bot_exit(app_handle, state.exit_notified.as_ref(), "disconnected");
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

  // 1. 感知背包物品
  observation.push_str("【当前物品栏与装备】:\n");
  let inventory = bot.get_inventory();
  if let Some(contents) = inventory.contents() {
    for (index, slot) in contents.iter().enumerate() {
      // 如果槽位中有物品，提取其类型和数量
      if let ItemStack::Present(item) = slot {
        observation.push_str(&format!(
          "- 槽位 {}: {:?} (数量: {})\n",
          index, item.kind, item.count
        ));
      }
    }
  } else {
    observation.push_str("- 物品栏为空或未加载\n");
  }

  // 2. 感知周边实体 (距离 < 10格)
  observation.push_str("\n【附近的实体】:\n");
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

  // 3. 感知周边方块 (5x5x5)
  observation.push_str("\n【附近的方块】:\n");
  let world_lock = bot.world();
  let instance = world_lock.read();
  let search_radius = 5;
  for x in -search_radius..=search_radius {
    for y in -search_radius..=search_radius {
      for z in -search_radius..=search_radius {
        let check_pos = block_pos.up(y).east(x).south(z);
        if let Some(state) = instance.get_block_state(check_pos) {
          let block_desc = format!("{:?}", state);
          // 剔除无价值背景方块
          if !block_desc.contains("Air") {
            observation.push_str(&format!(
              "- {}: [{}, {}, {}]\n",
              block_desc, check_pos.x, check_pos.y, check_pos.z
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

  if let Some(spoken_text) = decision.dialogue {
    if !spoken_text.is_empty() {
      // 调用底层 API，将生成的自然语言发送到游戏公屏
      bot.chat(&spoken_text);
    }
  }

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
    ActionType::Equip => {
      if let (Some(src), Some(dst)) = (decision.slot_source, decision.slot_destination) {
        println!(">>> 执行: 整理物品，将槽位 {} 移动至槽位 {}", src, dst);
        let inv = bot.get_inventory();
        inv.left_click(src);
        inv.left_click(dst);
      }
    }
    ActionType::GotoPlayer => {
      if let Some(player_name) = decision.target_name {
        println!(">>> 执行: 寻路前往玩家 {}", player_name);

        let target = bot.any_entity_by::<&GameProfileComponent, With<Player>>(
          |profile: &GameProfileComponent| profile.name == player_name,
        );

        if let Some(player) = target {
          bot.start_goto(BlockPosGoal(BlockPos::from(player.position())));
        } else {
          bot.chat("系统提示：目标玩家不在渲染距离内。");
        }
      }
    }
    ActionType::Wait => {
      println!(">>> 执行: 保持待机");
    }
  }
}

async fn query_llm_decision(state: &AgentState, observation: &str) -> SJMCLResult<AgentDecision> {
  // 1. 构建系统提示词和用户输入，兼容不同 provider 的消息格式要求
  let system_prompt = "你是一个 Minecraft 游戏中的智能体缪汐(Miuxi)，在探索这个世界你需要做出合理的行动决策，通过输出符合格式的 JSON 与世界和玩家交互。";
  let user_prompt = format!(
    "当前环境观察如下：\n{}\n\n请基于以上观察，做出一个合理的行动决策。返回 JSON 字段：thought, dialogue, action({}), target_coords(可选), target_entity_id(可选，为实体 ID), target_name(可选，为玩家名字)。\
    不要输出 JSON 之外的内容。\
    如果其他玩家对你说话，或者你需要通报你的发现，请在 `dialogue` 字段中生成一句自然、口语化的中文回复。如果没有必要说话，该字段可以为空。 \
    `action` 字段包含的指令中 move 指令能够到达任何指定的远处坐标，内置的自动寻路算法会处理路径规划；当玩家发出跟随请求时，直接使用 goto_player，并指定 target_name，系统会自动尝试寻路到目标玩家。",
    observation,
    ActionType::iter()
      .filter_map(|a| {
        serde_json::to_value(a)
          .ok()
          .and_then(|value| value.as_str().map(|s| s.to_string()))
      })
      .collect::<Vec<_>>()
      .join("/")
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
