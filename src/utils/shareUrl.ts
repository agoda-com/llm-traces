export interface ShareLocation {
  pathname: string;
  search: string;
  hash: string;
}

// `location` comes from locationService.getLocation(), whose pathname is relative to Grafana's
// sub-path (the history object is created with basename = appSubUrl). `appUrl` already contains
// the sub-path, so joining the two yields the absolute URL without adding the sub-path twice.
export function buildShareUrl(appUrl: string, location: ShareLocation): string {
  return `${appUrl.replace(/\/+$/, '')}${location.pathname}${location.search}${location.hash}`;
}
