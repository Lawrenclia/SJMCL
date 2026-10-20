pub mod source;

use async_speed_limit::Limiter;
use futures::{StreamExt, TryStreamExt};
use serde::{Deserialize, Serialize};
use sjmcl_types::error::{SJMCLError, SJMCLResult};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tauri::http::StatusCode;
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_http::reqwest;
use tauri_plugin_http::reqwest::header::RANGE;
use tokio::io::AsyncWriteExt;
use tokio_util::compat::FuturesAsyncReadCompatExt;

use crate::launcher_config::commands::retrieve_launcher_config;
use crate::resource::helpers::curseforge::misc::{
  CURSEFORGE_API_KEY, is_curseforge_authenticated_url,
};
use crate::tasks::streams::ProgressStream;
use crate::tasks::streams::desc::{PDesc, PStatus};
use crate::tasks::streams::reporter::Reporter;
use crate::tasks::*;
use crate::utils::fs::validate_sha1;
use crate::utils::web::{build_sjmcl_download_client, with_download_retry};

/// A client dedicated to file transfers.
///
/// Metadata requests use the shared [`reqwest::Client`], which has a short
/// overall timeout. Downloads must not be killed by that timeout, so they keep
/// their own client with connect / read timeouts instead.
pub struct DownloadClient(pub reqwest::Client);

impl DownloadClient {
  pub fn new(app_handle: &AppHandle) -> Self {
    Self(build_sjmcl_download_client(app_handle))
  }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DownloadParam {
  pub src: Url,
  pub dest: PathBuf,
  pub filename: Option<String>,
  pub sha1: Option<String>,
}

pub struct DownloadTask {
  p_handle: PTaskHandle,
  param: DownloadParam,
  dest_path: PathBuf,
  part_path: PathBuf,
  candidates: Vec<Url>,
}

impl DownloadTask {
  pub fn new(
    app_handle: AppHandle,
    task_id: u32,
    task_group: Option<String>,
    param: DownloadParam,
    report_interval: Duration,
  ) -> Self {
    let config = retrieve_launcher_config(app_handle.clone()).unwrap();
    let cache_dir = config.download.cache.directory.clone();
    let candidates = source::resolve_download_candidates(&param.src, &config);

    Self::from_parts(
      app_handle,
      task_id,
      task_group,
      param,
      cache_dir,
      candidates,
      report_interval,
    )
  }

  fn from_parts(
    app_handle: AppHandle,
    task_id: u32,
    task_group: Option<String>,
    param: DownloadParam,
    cache_dir: PathBuf,
    candidates: Vec<Url>,
    report_interval: Duration,
  ) -> Self {
    let dest_path = cache_dir.join(&param.dest);
    let part_path = part_path_for(&dest_path);
    let descriptor_path = descriptor_path(&cache_dir, task_id);

    DownloadTask {
      p_handle: PTaskHandle::new(
        PDesc::<PTaskParam>::new(
          task_id,
          task_group,
          0,
          PTaskParam::Download(param.clone()),
          PStatus::InProgress,
        ),
        report_interval,
        descriptor_path,
        Reporter::new(0, report_interval, TauriEventSink::new(app_handle)),
      ),
      param,
      dest_path,
      part_path,
      candidates,
    }
  }

  pub fn from_descriptor(
    app_handle: AppHandle,
    mut desc: PTaskDesc,
    report_interval: Duration,
    reset: bool,
  ) -> Self {
    let param = match &desc.payload {
      PTaskParam::Download(param) => param.clone(),
    };

    let config = retrieve_launcher_config(app_handle.clone()).unwrap();
    let cache_dir = config.download.cache.directory.clone();
    let candidates = source::resolve_download_candidates(&param.src, &config);

    if reset {
      desc.current = 0;
      let _ = std::fs::remove_file(part_path_for(&cache_dir.join(&param.dest)));
    }

    let task_id = desc.task_id;
    let task_group = desc.task_group.clone();
    let mut task = Self::from_parts(
      app_handle,
      task_id,
      task_group,
      param,
      cache_dir,
      candidates,
      report_interval,
    );
    task.p_handle.desc = PDesc {
      status: PStatus::Waiting,
      ..desc
    };
    task
  }

  /// `true` when the final destination already holds a verified file, so the
  /// transfer can be skipped entirely (kept intact on retry).
  async fn is_dest_verified(param: &DownloadParam, dest_path: &Path) -> bool {
    if param.sha1.is_none() || !dest_path.is_file() {
      return false;
    }
    Self::verify_file(param, dest_path).await.is_ok()
  }

  /// Verify a local file against the expected sha1 of the task.
  async fn verify_file(param: &DownloadParam, path: &Path) -> SJMCLResult<()> {
    if let Some(truth) = param.sha1.clone() {
      let path = path.to_path_buf();
      tokio::task::spawn_blocking(move || validate_sha1(path, truth))
        .await
        .map_err(|e| SJMCLError(format!("file verification task failed: {e}")))??;
    }
    Ok(())
  }

  async fn send_request(
    app_handle: &AppHandle,
    url: &Url,
    start: u64,
    use_range: bool,
  ) -> SJMCLResult<reqwest::Response> {
    let client = with_download_retry(app_handle.state::<DownloadClient>().0.clone());
    let mut request = client.get(url.clone());
    if use_range {
      request = request.header(RANGE, format!("bytes={start}-"));
    }

    // add api key header for CurseForge download urls (#1679)
    // ref: https://blog.curseforge.com/introducing-api-key-authentication-for-curseforge-file-downloads
    if is_curseforge_authenticated_url(url) {
      request = request.header("x-api-key", CURSEFORGE_API_KEY.as_str());
    }

    request.send().await.map_err(|e| {
      SJMCLError(format!(
        "request to {} failed: {e}",
        url.host_str().unwrap_or("unknown host")
      ))
    })
  }

  /// Transfer a single candidate URL into the `.part` file, resuming from the
  /// existing partial file when possible, then verify and atomically move it
  /// into place.
  async fn try_download(
    app_handle: &AppHandle,
    handle: &Arc<RwLock<PTaskHandle>>,
    candidate: &Url,
    param: &DownloadParam,
    dest_path: &Path,
    part_path: &Path,
    limiter: Option<Limiter>,
  ) -> SJMCLResult<()> {
    let mut resume_from = tokio::fs::metadata(part_path)
      .await
      .map(|meta| meta.len())
      .unwrap_or(0);

    let mut use_range = resume_from > 0;

    loop {
      let response = Self::send_request(app_handle, candidate, resume_from, use_range).await?;
      let status = response.status();

      if use_range && status == StatusCode::RANGE_NOT_SATISFIABLE {
        // The partial file is at least as large as the remote file. Keep it if
        // it verifies, otherwise restart from the beginning.
        if Self::verify_file(param, part_path).await.is_ok() {
          return Self::finish_download(part_path, dest_path, handle).await;
        }
        let _ = tokio::fs::remove_file(part_path).await;
        resume_from = 0;
        use_range = false;
        continue;
      }

      if use_range && status != StatusCode::PARTIAL_CONTENT {
        // The server ignored the Range header (or the file changed). Start over.
        let _ = tokio::fs::remove_file(part_path).await;
        resume_from = 0;
        use_range = false;
        continue;
      }

      if !status.is_success() {
        return Err(SJMCLError(format!(
          "HTTP {} from {}",
          status.as_u16(),
          candidate.host_str().unwrap_or("unknown host")
        )));
      }

      // For 206 responses content-length is the remaining length.
      let full_total = response
        .content_length()
        .map(|length| length as i64 + resume_from as i64);

      {
        let mut handle = handle.write().unwrap();
        handle.set_total(full_total.unwrap_or(-1));
        handle.set_current(resume_from as i64);
        handle.mark_started();
      }

      if let Some(parent) = dest_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
      }
      let mut file = if resume_from == 0 {
        tokio::fs::File::create(part_path).await?
      } else {
        tokio::fs::OpenOptions::new()
          .append(true)
          .open(part_path)
          .await?
      };

      // Do not swallow body errors: a broken connection must abort the attempt
      // instead of silently producing a truncated file.
      let stream = response
        .bytes_stream()
        .map(|chunk| chunk.map_err(|e| std::io::Error::other(e.to_string())));

      let stream = ProgressStream::new(stream, handle.clone());
      let copy_result = if let Some(limiter) = &limiter {
        let limited = limiter.clone().limit(stream.into_async_read());
        tokio::io::copy(&mut limited.compat(), &mut file).await
      } else {
        tokio::io::copy(&mut stream.into_async_read().compat(), &mut file).await
      };

      let _ = file.flush().await;
      drop(file);

      copy_result.map_err(|e| SJMCLError(format!("transfer interrupted: {e}")))?;

      if handle.read().unwrap().status().is_cancelled() {
        return Ok(());
      }

      if let Some(expected_total) = full_total {
        let current = handle.read().unwrap().desc.current;
        if current != expected_total {
          return Err(SJMCLError(format!(
            "incomplete transfer: received {current} of {expected_total} bytes"
          )));
        }
      }

      // A verification failure means the (possibly resumed) partial file is
      // unusable: drop it so the next candidate starts from scratch.
      if let Err(error) = Self::verify_file(param, part_path).await {
        let _ = tokio::fs::remove_file(part_path).await;
        return Err(error);
      }

      return Self::finish_download(part_path, dest_path, handle).await;
    }
  }

  async fn finish_download(
    part_path: &Path,
    dest_path: &Path,
    handle: &Arc<RwLock<PTaskHandle>>,
  ) -> SJMCLResult<()> {
    tokio::fs::rename(part_path, dest_path).await.map_err(|e| {
      SJMCLError(format!(
        "failed to move {} into place: {e}",
        dest_path.display()
      ))
    })?;
    handle.write().unwrap().mark_completed();
    Ok(())
  }

  async fn future_impl(
    self,
    app_handle: AppHandle,
    limiter: Option<Limiter>,
  ) -> SJMCLResult<(
    impl Future<Output = SJMCLResult<()>> + Send,
    Arc<RwLock<PTaskHandle>>,
  )> {
    let handle = Arc::new(RwLock::new(self.p_handle));
    let task_handle = handle.clone();
    let param = self.param;
    let dest_path = self.dest_path;
    let part_path = self.part_path;
    let candidates = self.candidates;

    Ok((
      async move {
        // Keep an already verified file instead of downloading it again.
        if Self::is_dest_verified(&param, &dest_path).await {
          let total = std::fs::metadata(&dest_path)
            .map(|meta| meta.len() as i64)
            .unwrap_or(-1);
          let mut handle = task_handle.write().unwrap();
          handle.set_total(total);
          handle.set_current(total);
          handle.mark_started();
          handle.mark_completed();
          return Ok(());
        }

        // Never leave an unverified final file behind after a failed transfer.
        if dest_path.exists() {
          let _ = tokio::fs::remove_file(&dest_path).await;
        }

        let mut errors = Vec::with_capacity(candidates.len());
        for candidate in &candidates {
          match Self::try_download(
            &app_handle,
            &task_handle,
            candidate,
            &param,
            &dest_path,
            &part_path,
            limiter.clone(),
          )
          .await
          {
            Ok(()) => return Ok(()),
            Err(error) => {
              log::warn!(
                "download from {} failed: {}",
                candidate.host_str().unwrap_or("unknown host"),
                error.0
              );
              errors.push(format!(
                "{}: {}",
                candidate.host_str().unwrap_or("unknown host"),
                error.0
              ));
            }
          }
        }

        Err(SJMCLError(format!(
          "download failed after trying {} source(s): {}",
          candidates.len(),
          errors.join("; ")
        )))
      },
      handle,
    ))
  }

  pub async fn future(
    self,
    app_handle: AppHandle,
    limiter: Option<Limiter>,
  ) -> SJMCLResult<(
    impl Future<Output = SJMCLResult<()>> + Send,
    Arc<RwLock<PTaskHandle>>,
  )> {
    Self::future_impl(self, app_handle, limiter).await
  }
}

/// Path of the partial file for a given final destination.
pub fn part_path_for(dest_path: &Path) -> PathBuf {
  let mut os_string = dest_path.as_os_str().to_os_string();
  os_string.push(".part");
  PathBuf::from(os_string)
}

/// Directory holding persisted task descriptors.
pub fn descriptors_dir(cache_dir: &Path) -> PathBuf {
  cache_dir.join("descriptors")
}

/// Path of the persisted descriptor of a task.
pub fn descriptor_path(cache_dir: &Path, task_id: u32) -> PathBuf {
  descriptors_dir(cache_dir).join(format!("task_{task_id}.json"))
}
