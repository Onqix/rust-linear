use crate::db::BridgeSettings;
use crate::mcp::{self, McpContext, Notify};
use chrono::{SecondsFormat, Utc};
use rusqlite::Connection;
use serde::Serialize;
use std::process::Stdio;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::io::AsyncBufReadExt;
use tokio::sync::{oneshot, watch, Mutex as TokioMutex};
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Serialize)]
pub struct BridgeStatus {
    pub server_running: bool,
    pub server_error: Option<String>,
    pub port: u16,
    pub last_request_at: Option<String>,
    pub tunnel_state: String,
    pub tunnel_error: Option<String>,
    pub tunnel_since: Option<String>,
}

struct BridgeStateSnapshot {
    server_running: bool,
    server_error: Option<String>,
    port: u16,
    tunnel_state: String,
    tunnel_error: Option<String>,
    tunnel_since: Option<String>,
}

impl Default for BridgeStateSnapshot {
    fn default() -> Self {
        Self {
            server_running: false,
            server_error: None,
            port: 47100,
            tunnel_state: "off".to_string(),
            tunnel_error: None,
            tunnel_since: None,
        }
    }
}

#[derive(Default)]
struct BridgeRuntime {
    server_shutdown: Option<oneshot::Sender<()>>,
    server_task: Option<JoinHandle<()>>,
    tunnel_cancel: Option<watch::Sender<bool>>,
    tunnel_task: Option<JoinHandle<()>>,
}

pub struct BridgeController {
    inner: TokioMutex<BridgeRuntime>,
    state: Arc<StdMutex<BridgeStateSnapshot>>,
    last_request_at: Arc<StdMutex<Option<String>>>,
}

impl Default for BridgeController {
    fn default() -> Self {
        Self::new()
    }
}

impl BridgeController {
    pub fn new() -> Self {
        Self {
            inner: TokioMutex::new(BridgeRuntime::default()),
            state: Arc::new(StdMutex::new(BridgeStateSnapshot::default())),
            last_request_at: Arc::new(StdMutex::new(None)),
        }
    }

    pub async fn apply(
        &self,
        settings: BridgeSettings,
        db: Arc<StdMutex<Connection>>,
        notify: Notify,
        app_version: String,
    ) {
        let mut rt = self.inner.lock().await;
        stop_runtime(&mut rt, &self.state).await;

        if let Ok(mut st) = self.state.lock() {
            st.port = settings.port;
        }

        if settings.server_enabled {
            if let Ok(mut st) = self.state.lock() {
                st.server_running = true;
                st.server_error = None;
            }

            let ctx = Arc::new(McpContext {
                db,
                notify,
                token: settings.token.clone(),
                app_version,
                last_request_at: Arc::clone(&self.last_request_at),
            });

            let (shutdown_tx, shutdown_rx) = oneshot::channel();
            let state_for_srv = Arc::clone(&self.state);
            let port = settings.port;
            let handle = tokio::spawn(async move {
                match mcp::serve(ctx, port, shutdown_rx).await {
                    Ok(()) => {
                        if let Ok(mut st) = state_for_srv.lock() {
                            st.server_running = false;
                        }
                    }
                    Err(err) => {
                        if let Ok(mut st) = state_for_srv.lock() {
                            st.server_running = false;
                            st.server_error = Some(err);
                        }
                    }
                }
            });

            rt.server_shutdown = Some(shutdown_tx);
            rt.server_task = Some(handle);

            // Give listener bind a brief moment so immediate bind failures (e.g. port in use)
            // are visible right away in the returned status.
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        let target = settings.ssh_target.trim().to_string();
        if settings.tunnel_enabled && !target.is_empty() {
            let (cancel_tx, cancel_rx) = watch::channel(false);
            let state_for_tunnel = Arc::clone(&self.state);
            let local_port = settings.port;
            let remote_port = settings.remote_port;
            let handle = tokio::spawn(async move {
                run_tunnel_supervisor(target, local_port, remote_port, cancel_rx, state_for_tunnel)
                    .await;
            });

            rt.tunnel_cancel = Some(cancel_tx);
            rt.tunnel_task = Some(handle);
        }
    }

    pub async fn stop_all(&self) {
        let mut rt = self.inner.lock().await;
        stop_runtime(&mut rt, &self.state).await;
    }

    pub async fn status(&self) -> BridgeStatus {
        let snap = match self.state.lock() {
            Ok(st) => BridgeStatus {
                server_running: st.server_running,
                server_error: st.server_error.clone(),
                port: st.port,
                last_request_at: None,
                tunnel_state: st.tunnel_state.clone(),
                tunnel_error: st.tunnel_error.clone(),
                tunnel_since: st.tunnel_since.clone(),
            },
            Err(_) => BridgeStatus {
                server_running: false,
                server_error: Some("Bridge state lock poisoned".to_string()),
                port: 47100,
                last_request_at: None,
                tunnel_state: "error".to_string(),
                tunnel_error: Some("Bridge state lock poisoned".to_string()),
                tunnel_since: None,
            },
        };
        let last_req = self
            .last_request_at
            .lock()
            .ok()
            .and_then(|g| g.clone());
        BridgeStatus {
            last_request_at: last_req,
            ..snap
        }
    }
}

async fn stop_runtime(rt: &mut BridgeRuntime, state: &Arc<StdMutex<BridgeStateSnapshot>>) {
    if let Some(tx) = rt.server_shutdown.take() {
        let _ = tx.send(());
    }
    if let Some(handle) = rt.server_task.take() {
        let _ = tokio::time::timeout(Duration::from_secs(2), handle).await;
    }

    if let Some(tx) = rt.tunnel_cancel.take() {
        let _ = tx.send(true);
    }
    if let Some(handle) = rt.tunnel_task.take() {
        let _ = tokio::time::timeout(Duration::from_secs(3), handle).await;
    }

    if let Ok(mut st) = state.lock() {
        st.server_running = false;
        st.server_error = None;
        st.tunnel_state = "off".to_string();
        st.tunnel_error = None;
        st.tunnel_since = None;
    }
}

async fn wait_cancelled(rx: &mut watch::Receiver<bool>) {
    while !*rx.borrow() {
        if rx.changed().await.is_err() {
            return;
        }
    }
}

async fn run_tunnel_supervisor(
    ssh_target: String,
    local_port: u16,
    remote_port: u16,
    mut cancel_rx: watch::Receiver<bool>,
    state: Arc<StdMutex<BridgeStateSnapshot>>,
) {
    let mut backoff_secs: u64 = 5;
    let forward_spec = format!("127.0.0.1:{remote_port}:127.0.0.1:{local_port}");

    loop {
        if *cancel_rx.borrow() {
            break;
        }

        if let Ok(mut st) = state.lock() {
            st.tunnel_state = "connecting".to_string();
            st.tunnel_error = None;
            st.tunnel_since = None;
        }

        let mut cmd = tokio::process::Command::new("ssh");
        // No `-N`: the remote side runs `cat`, which reads our stdin pipe. If this app exits
        // for any reason (crash, update restart), the OS closes the pipe, the remote `cat`
        // ends and ssh exits, so a stale tunnel can never keep holding the remote port.
        cmd.args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ServerAliveInterval=30",
            "-o",
            "ServerAliveCountMax=3",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-R",
            &forward_spec,
            &ssh_target,
            "cat >/dev/null",
        ])
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                if let Ok(mut st) = state.lock() {
                    st.tunnel_state = "error".to_string();
                    st.tunnel_error = Some(format!("Failed to launch ssh: {e}"));
                    st.tunnel_since = None;
                }
                let cancelled = tokio::select! {
                    _ = wait_cancelled(&mut cancel_rx) => true,
                    _ = tokio::time::sleep(Duration::from_secs(backoff_secs)) => false,
                };
                if cancelled {
                    break;
                }
                backoff_secs = (backoff_secs * 2).min(60);
                continue;
            }
        };

        // Hold the write end of ssh's stdin for as long as the child runs (see above).
        let _stdin_guard = child.stdin.take();

        let stderr_task = child.stderr.take().map(|stderr| {
            tokio::spawn(async move {
                let mut lines = tokio::io::BufReader::new(stderr).lines();
                let mut last_non_empty: Option<String> = None;
                while let Ok(Some(line)) = lines.next_line().await {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        last_non_empty = Some(trimmed.to_string());
                    }
                }
                last_non_empty
            })
        });

        let started_at = std::time::Instant::now();

        let early_exit = tokio::select! {
            _ = wait_cancelled(&mut cancel_rx) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                if let Some(t) = stderr_task {
                    t.abort();
                }
                break;
            }
            res = child.wait() => Some(res),
            _ = tokio::time::sleep(Duration::from_secs(4)) => {
                let since = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
                if let Ok(mut st) = state.lock() {
                    st.tunnel_state = "connected".to_string();
                    st.tunnel_error = None;
                    st.tunnel_since = Some(since);
                }
                None
            }
        };

        let wait_res = match early_exit {
            Some(res) => res,
            None => {
                tokio::select! {
                    _ = wait_cancelled(&mut cancel_rx) => {
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        if let Some(t) = stderr_task {
                            t.abort();
                        }
                        break;
                    }
                    res = child.wait() => res,
                }
            }
        };

        let last_stderr = match stderr_task {
            Some(t) => t.await.ok().flatten(),
            None => None,
        };

        let err_msg = last_stderr.unwrap_or_else(|| match wait_res {
            Ok(status) => format!("SSH tunnel exited ({status})"),
            Err(e) => format!("SSH tunnel wait error: {e}"),
        });

        if let Ok(mut st) = state.lock() {
            st.tunnel_state = "error".to_string();
            st.tunnel_error = Some(err_msg);
            st.tunnel_since = None;
        }

        if started_at.elapsed() > Duration::from_secs(60) {
            backoff_secs = 5;
        }

        let cancelled = tokio::select! {
            _ = wait_cancelled(&mut cancel_rx) => true,
            _ = tokio::time::sleep(Duration::from_secs(backoff_secs)) => false,
        };
        if cancelled {
            break;
        }
        backoff_secs = (backoff_secs * 2).min(60);
    }

    if let Ok(mut st) = state.lock() {
        st.tunnel_state = "off".to_string();
        st.tunnel_error = None;
        st.tunnel_since = None;
    }
}
