use sjmcl_types::error::SJMCLResult;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_http::reqwest;

use crate::instance::helpers::client_json::McClientInfo;
use crate::instance::helpers::misc::get_instance_subdir_path_by_id;
use crate::instance::models::misc::{InstanceSubdirType, ModLoaderType};
use crate::launcher_config::models::LauncherConfig;
use crate::resource::helpers::curseforge::{
  fetch_remote_resource_by_id_curseforge, fetch_remote_resource_by_local_curseforge,
  fetch_resource_list_by_name_curseforge, fetch_resource_version_packs_curseforge,
};
use crate::resource::helpers::loader_meta::cleanroom::get_cleanroom_meta_by_game_version;
use crate::resource::helpers::loader_meta::fabric::get_fabric_meta_by_game_version;
use crate::resource::helpers::loader_meta::forge::get_forge_meta_by_game_version;
use crate::resource::helpers::loader_meta::neoforge::get_neoforge_meta_by_game_version;
use crate::resource::helpers::loader_meta::optifine::get_optifine_meta_by_game_version;
use crate::resource::helpers::loader_meta::quilt::get_quilt_meta_by_game_version;
use crate::resource::helpers::misc::{get_source_priority_list, resolve_mod_update_paths};
use crate::resource::helpers::modrinth::{
  fetch_remote_resource_by_id_modrinth, fetch_remote_resource_by_local_modrinth,
  fetch_resource_list_by_name_modrinth, fetch_resource_version_packs_modrinth,
};
use crate::resource::helpers::version_manifest::get_game_version_manifest;
use crate::resource::models::{
  GameClientResourceInfo, ModLoaderResourceInfo, ModUpdateQuery, OptiFineResourceInfo,
  OtherResourceFileInfo, OtherResourceInfo, OtherResourceSearchQuery, OtherResourceSearchRes,
  OtherResourceSource, OtherResourceVersionPack, OtherResourceVersionPackQuery, ResourceError,
};
use crate::tasks::PTaskParam;
use crate::tasks::commands::{
  schedule_progressive_task_group, schedule_progressive_task_group_inner,
};
use crate::tasks::download::DownloadParam;
use crate::tasks::monitor::{GroupHooks, make_group_hook};

#[tauri::command]
pub async fn fetch_game_version_list(app: AppHandle) -> SJMCLResult<Vec<GameClientResourceInfo>> {
  let priority_list = {
    let launcher_config_state = app.state::<Mutex<LauncherConfig>>();
    let launcher_config = launcher_config_state.lock()?;
    get_source_priority_list(&launcher_config)
  };
  get_game_version_manifest(&app, &priority_list).await
}

#[tauri::command]
pub async fn fetch_game_version_specific(
  app: AppHandle,
  game_version: String,
) -> SJMCLResult<GameClientResourceInfo> {
  let all_versions = fetch_game_version_list(app.clone()).await?;

  all_versions
    .into_iter()
    .find(|item| item.id == game_version)
    .ok_or_else(|| ResourceError::ClientVersionNotFound.into())
}

#[tauri::command]
pub async fn fetch_mod_loader_version_list(
  app: AppHandle,
  game_version: String,
  mod_loader_type: ModLoaderType,
) -> SJMCLResult<Vec<ModLoaderResourceInfo>> {
  let priority_list = {
    let launcher_config_state = app.state::<Mutex<LauncherConfig>>();
    let launcher_config = launcher_config_state.lock()?;
    get_source_priority_list(&launcher_config)
  };
  match mod_loader_type {
    ModLoaderType::Forge | ModLoaderType::LegacyForge => {
      Ok(get_forge_meta_by_game_version(&app, &priority_list, &game_version).await?)
    }
    ModLoaderType::Cleanroom => Ok(get_cleanroom_meta_by_game_version(&app, &game_version).await?),
    ModLoaderType::Fabric => {
      Ok(get_fabric_meta_by_game_version(&app, &priority_list, &game_version).await?)
    }
    ModLoaderType::NeoForge => {
      Ok(get_neoforge_meta_by_game_version(&app, &priority_list, &game_version).await?)
    }
    ModLoaderType::Quilt => {
      Ok(get_quilt_meta_by_game_version(&app, &priority_list, &game_version).await?)
    }
    // TODO here
    _ => Err(ResourceError::NoDownloadApi.into()),
  }
}

#[tauri::command]
pub async fn fetch_optifine_version_list(
  app: AppHandle,
  game_version: String,
) -> SJMCLResult<Vec<OptiFineResourceInfo>> {
  let priority_list = {
    let launcher_config_state = app.state::<Mutex<LauncherConfig>>();
    let launcher_config = launcher_config_state.lock()?;
    get_source_priority_list(&launcher_config)
  };
  get_optifine_meta_by_game_version(&app, &priority_list, &game_version).await
}

#[tauri::command]
pub async fn fetch_resource_list_by_name(
  app: AppHandle,
  download_source: OtherResourceSource,
  query: OtherResourceSearchQuery,
) -> SJMCLResult<OtherResourceSearchRes> {
  match download_source {
    OtherResourceSource::CurseForge => {
      Ok(fetch_resource_list_by_name_curseforge(&app, &query).await?)
    }
    OtherResourceSource::Modrinth => Ok(fetch_resource_list_by_name_modrinth(&app, &query).await?),
    _ => Err(ResourceError::NoDownloadApi.into()),
  }
}

#[tauri::command]
pub async fn fetch_resource_version_packs(
  app: AppHandle,
  download_source: OtherResourceSource,
  query: OtherResourceVersionPackQuery,
) -> SJMCLResult<Vec<OtherResourceVersionPack>> {
  match download_source {
    OtherResourceSource::CurseForge => {
      Ok(fetch_resource_version_packs_curseforge(&app, &query).await?)
    }
    OtherResourceSource::Modrinth => Ok(fetch_resource_version_packs_modrinth(&app, &query).await?),
    _ => Err(ResourceError::NoDownloadApi.into()),
  }
}

#[tauri::command]
pub async fn download_game_server(
  app: AppHandle,
  client: State<'_, reqwest::Client>,
  resource_info: GameClientResourceInfo,
  dest: String,
) -> SJMCLResult<()> {
  let version_details = client
    .get(&resource_info.url)
    .send()
    .await
    .map_err(|_| ResourceError::NetworkError)?
    .json::<McClientInfo>()
    .await
    .map_err(|_| ResourceError::ParseError)?;

  let download_info = version_details
    .downloads
    .get("server")
    .ok_or(ResourceError::ParseError)?;

  schedule_progressive_task_group(
    app,
    format!("game-server?{}", resource_info.id),
    vec![PTaskParam::Download(DownloadParam {
      src: url::Url::parse(&download_info.url.clone()).map_err(|_| ResourceError::ParseError)?,
      dest: dest.clone().into(),
      filename: None,
      sha1: Some(download_info.sha1.clone()),
      size: Some(download_info.size as u64),
    })],
    true,
  )
  .await?;

  Ok(())
}

#[tauri::command]
pub async fn fetch_remote_resource_by_local(
  app: AppHandle,
  download_source: OtherResourceSource,
  file_path: String,
) -> SJMCLResult<OtherResourceFileInfo> {
  match download_source {
    OtherResourceSource::CurseForge => {
      Ok(fetch_remote_resource_by_local_curseforge(&app, &file_path).await?)
    }
    OtherResourceSource::Modrinth => {
      Ok(fetch_remote_resource_by_local_modrinth(&app, &file_path).await?)
    }
    _ => Err(ResourceError::NoDownloadApi.into()),
  }
}

#[tauri::command]
pub async fn update_mods(
  app: AppHandle,
  instance_id: String,
  queries: Vec<ModUpdateQuery>,
) -> SJMCLResult<()> {
  if queries.is_empty() {
    return Ok(());
  }

  let mods_dir = match get_instance_subdir_path_by_id(&app, &instance_id, &InstanceSubdirType::Mods)
  {
    Some(path) => path,
    None => return Ok(()),
  };

  let update_paths = resolve_mod_update_paths(&mods_dir, &queries)?;

  let mut download_tasks = Vec::new();
  for (query, (_, new_file_path)) in queries.iter().zip(&update_paths) {
    let download_param = DownloadParam {
      src: url::Url::parse(&query.url).map_err(|_| ResourceError::ParseError)?,
      dest: new_file_path.clone(),
      filename: None,
      sha1: Some(query.sha1.clone()),
      size: None,
    };
    download_tasks.push(PTaskParam::Download(download_param));
  }

  // Keep the old files until every replacement has been downloaded and
  // verified: deleting them up front would leave the instance without a
  // working mod when the download fails. The superseded files (and legacy
  // `.old` leftovers from earlier versions) are removed by the group hook.
  let old_paths: Vec<std::path::PathBuf> = update_paths
    .iter()
    .filter(|(old_file_path, new_file_path)| old_file_path != new_file_path)
    .map(|(old_file_path, _)| old_file_path.clone())
    .collect();
  let hooks = GroupHooks {
    on_success: vec![make_group_hook(move |_app| async move {
      for old_path in old_paths {
        let legacy_path = format!("{}.old", old_path.display());
        for path in [old_path, std::path::PathBuf::from(legacy_path)] {
          if path.is_file()
            && let Err(e) = std::fs::remove_file(&path)
          {
            log::warn!(
              "Failed to remove superseded mod file {}: {}",
              path.display(),
              e
            );
          }
        }
      }
    })],
    on_failure: Vec::new(),
  };

  schedule_progressive_task_group_inner(
    app,
    "mod-update".to_string(),
    download_tasks,
    true,
    Some(hooks),
  )
  .await?;

  Ok(())
}

#[tauri::command]
pub async fn fetch_remote_resource_by_id(
  app: AppHandle,
  download_source: OtherResourceSource,
  resource_id: String,
) -> SJMCLResult<OtherResourceInfo> {
  match download_source {
    OtherResourceSource::CurseForge => {
      Ok(fetch_remote_resource_by_id_curseforge(&app, &resource_id).await?)
    }
    OtherResourceSource::Modrinth => {
      Ok(fetch_remote_resource_by_id_modrinth(&app, &resource_id).await?)
    }
    _ => Err(ResourceError::NoDownloadApi.into()),
  }
}
