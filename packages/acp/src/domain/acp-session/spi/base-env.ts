/**
 * What every ACP program needs from its environment to start and reach the network: the search path, the user's
 * identity and directories, the locale and terminal, and proxy and certificate settings.
 */
export const BASE_ENV: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_*",
  "TERM",
  "TZ",
  "XDG_*",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Windows needs these to start a program at all.
  "SystemRoot",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA"
];
