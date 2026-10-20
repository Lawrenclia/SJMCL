use url::Url;

use crate::launcher_config::models::LauncherConfig;
use crate::resource::helpers::misc::{convert_url_to_target_source, get_source_priority_list};

/// Resolve an ordered list of candidate URLs for one file download.
///
/// The candidate source order follows the user's download-source strategy
/// (`official` / `mirror` / `auto`), with the preferred source first and the
/// remaining sources kept as fallbacks. URLs that cannot be rewritten to
/// another source (e.g. mod CDN URLs from CurseForge / Modrinth) yield a
/// single candidate, which keeps the previous behavior for those files.
pub fn resolve_download_candidates(url: &Url, config: &LauncherConfig) -> Vec<Url> {
  let mut candidates: Vec<Url> = Vec::new();

  for source in get_source_priority_list(config) {
    let candidate = match convert_url_to_target_source(url, &[], &source) {
      Ok(candidate) => candidate,
      Err(_) => continue,
    };
    if !candidates.iter().any(|existing| existing == &candidate) {
      candidates.push(candidate);
    }
  }

  if candidates.is_empty() {
    candidates.push(url.clone());
  }

  candidates
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::launcher_config::models::LauncherConfig;

  #[test]
  fn mirror_strategy_puts_mirror_first_and_keeps_official_as_fallback() {
    let mut config = LauncherConfig::default();
    config.download.source.strategy = "mirror".to_string();

    let url =
      Url::parse("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json").unwrap();
    let candidates = resolve_download_candidates(&url, &config);

    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].host_str(), Some("bmclapi2.bangbang93.com"));
    assert_eq!(candidates[1].host_str(), Some("launchermeta.mojang.com"));
  }

  #[test]
  fn official_strategy_puts_official_first() {
    let mut config = LauncherConfig::default();
    config.download.source.strategy = "official".to_string();

    let url =
      Url::parse("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json").unwrap();
    let candidates = resolve_download_candidates(&url, &config);

    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].host_str(), Some("launchermeta.mojang.com"));
    assert_eq!(candidates[1].host_str(), Some("bmclapi2.bangbang93.com"));
  }

  #[test]
  fn unknown_url_keeps_a_single_candidate() {
    let config = LauncherConfig::default();
    let url = Url::parse("https://edge.forgecdn.net/files/1/2/mod.jar").unwrap();

    assert_eq!(resolve_download_candidates(&url, &config), vec![url]);
  }
}
