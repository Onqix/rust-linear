use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::oneshot;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";
const OAUTH_SCOPES: &str =
    "openid email https://www.googleapis.com/auth/generative-language";
const OAUTH_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleOAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub email: Option<String>,
}

/// Pure-Rust SHA-256 implementation (FIPS 180-4).
pub fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];

    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];

    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut padded = Vec::with_capacity(data.len() + 65);
    padded.extend_from_slice(data);
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0x00);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    for block in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                block[i * 4],
                block[i * 4 + 1],
                block[i * 4 + 2],
                block[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

/// Base64url encoder without `=` padding (RFC 4648 section 5).
pub fn base64url_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 0x3f) as usize] as char);
        }
    }
    out
}

/// Percent-encode a query parameter value according to RFC 3986.
pub fn url_encode(input: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(HEX[(b >> 4) as usize] as char);
            out.push(HEX[(b & 0x0f) as usize] as char);
        }
    }
    out
}

/// Generate a `(verifier, challenge)` PKCE S256 pair (RFC 7636).
pub fn generate_pkce_pair() -> (String, String) {
    let verifier = format!("{}{}", crate::db::generate_token(), crate::db::generate_token());
    let digest = sha256(verifier.as_bytes());
    let challenge = base64url_encode(&digest);
    (verifier, challenge)
}

#[derive(Clone)]
struct CallbackState {
    expected_state: String,
    sender: Arc<StdMutex<Option<oneshot::Sender<Result<String, String>>>>>,
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn callback_page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{}</title></head>\
         <body style=\"font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;\
         display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px\">\
         <div style=\"max-width:460px;text-align:center;background:#1e293b;border:1px solid #334155;\
         border-radius:12px;padding:28px 32px\">\
         <h2 style=\"margin:0 0 10px 0;font-size:20px\">{}</h2>\
         <p style=\"margin:0;color:#94a3b8;font-size:14px;line-height:1.5\">{}</p>\
         </div></body></html>",
        html_escape(title),
        html_escape(title),
        html_escape(message),
    )
}

async fn handle_oauth_callback(
    State(state): State<CallbackState>,
    Query(params): Query<HashMap<String, String>>,
) -> (StatusCode, Html<String>) {
    let send_result = |res: Result<String, String>| {
        if let Ok(mut guard) = state.sender.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(res);
            }
        }
    };

    if let Some(err) = params.get("error").map(String::as_str).filter(|s| !s.is_empty()) {
        let desc = params
            .get("error_description")
            .map(String::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or(err);
        let msg = format!("Google sign-in failed: {desc}");
        send_result(Err(msg.clone()));
        return (
            StatusCode::BAD_REQUEST,
            Html(callback_page("Sign-in failed", &msg)),
        );
    }

    let returned_state = params.get("state").map(String::as_str).unwrap_or("");
    if returned_state != state.expected_state {
        let msg = "OAuth state mismatch. Please retry signing in from Linear Pulse.".to_string();
        send_result(Err(msg.clone()));
        return (
            StatusCode::BAD_REQUEST,
            Html(callback_page("Sign-in failed", &msg)),
        );
    }

    let code = params.get("code").map(String::as_str).unwrap_or("").trim();
    if code.is_empty() {
        let msg = "Missing authorization code in Google OAuth callback.".to_string();
        send_result(Err(msg.clone()));
        return (
            StatusCode::BAD_REQUEST,
            Html(callback_page("Sign-in failed", &msg)),
        );
    }

    send_result(Ok(code.to_string()));
    (
        StatusCode::OK,
        Html(callback_page(
            "Signed in to Linear Pulse",
            "Signed in to Linear Pulse — you can close this tab.",
        )),
    )
}

fn open_auth_url(url: &str) -> Result<(), String> {
    let linux_res = crate::open_url_system(url);
    if linux_res.is_ok() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Failed to open browser via open: {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("Failed to open browser via cmd: {e}"))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        linux_res
    }
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    email: Option<String>,
}

pub async fn run_google_oauth_flow(
    client_id: &str,
    client_secret: &str,
) -> Result<GoogleOAuthTokens, String> {
    let trimmed_id = client_id.trim();
    if trimmed_id.is_empty() {
        return Err(
            "Google OAuth Client ID is empty. Enter a Google Cloud Desktop OAuth Client ID in Settings."
                .to_string(),
        );
    }
    let trimmed_secret = client_secret.trim();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local OAuth callback listener: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local callback port: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");

    let state_token = crate::db::generate_token();
    let (verifier, challenge) = generate_pkce_pair();

    let auth_url = format!(
        "{GOOGLE_AUTH_URL}?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
        url_encode(trimmed_id),
        url_encode(&redirect_uri),
        url_encode(OAUTH_SCOPES),
        url_encode(&challenge),
        url_encode(&state_token),
    );

    let (code_tx, code_rx) = oneshot::channel::<Result<String, String>>();
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let callback_state = CallbackState {
        expected_state: state_token,
        sender: Arc::new(StdMutex::new(Some(code_tx))),
    };

    let app = Router::new()
        .route("/oauth/callback", get(handle_oauth_callback))
        .with_state(callback_state);

    let server_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    if let Err(err) = open_auth_url(&auth_url) {
        let _ = shutdown_tx.send(());
        let _ = server_handle.await;
        return Err(err);
    }

    let code_wait = tokio::time::timeout(Duration::from_secs(OAUTH_TIMEOUT_SECS), code_rx).await;
    let _ = shutdown_tx.send(());
    let _ = server_handle.await;

    let code = match code_wait {
        Ok(Ok(Ok(code))) => code,
        Ok(Ok(Err(err))) => return Err(err),
        Ok(Err(_)) => {
            return Err("Google OAuth callback channel closed before completing.".to_string())
        }
        Err(_) => {
            return Err("Timed out waiting for Google sign-in in browser (180s).".to_string())
        }
    };

    let mut form_params: Vec<(&str, &str)> = vec![
        ("client_id", trimmed_id),
        ("code", &code),
        ("code_verifier", &verifier),
        ("redirect_uri", &redirect_uri),
        ("grant_type", "authorization_code"),
    ];
    if !trimmed_secret.is_empty() {
        form_params.push(("client_secret", trimmed_secret));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let res = client
        .post(GOOGLE_TOKEN_URL)
        .form(&form_params)
        .send()
        .await
        .map_err(|e| format!("Failed to exchange Google OAuth code: {e}"))?;

    let status = res.status();
    let body_text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Google OAuth token exchange failed ({status}): {body_text}"
        ));
    }

    let parsed: GoogleTokenResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse Google OAuth token response: {e}"))?;

    if let Some(err) = parsed.error.filter(|s| !s.trim().is_empty()) {
        let desc = parsed.error_description.unwrap_or(err);
        return Err(format!("Google OAuth token error: {desc}"));
    }

    let access_token = parsed
        .access_token
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Google OAuth response did not include an access_token.".to_string())?;

    let refresh_token = parsed
        .refresh_token
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let expires_in = parsed.expires_in.unwrap_or(3600).max(60);
    let expires_at = Utc::now().timestamp() + expires_in;

    let email = fetch_google_user_email(&client, &access_token).await;

    Ok(GoogleOAuthTokens {
        access_token,
        refresh_token,
        expires_at,
        email,
    })
}

async fn fetch_google_user_email(client: &reqwest::Client, access_token: &str) -> Option<String> {
    let res = client
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(access_token)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let info: GoogleUserInfo = res.json().await.ok()?;
    info.email
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub async fn refresh_google_access_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<(String, i64), String> {
    let trimmed_id = client_id.trim();
    if trimmed_id.is_empty() {
        return Err("Google OAuth Client ID is empty.".to_string());
    }
    let trimmed_refresh = refresh_token.trim();
    if trimmed_refresh.is_empty() {
        return Err("No Google OAuth refresh token available. Sign in with Google again.".to_string());
    }
    let trimmed_secret = client_secret.trim();

    let mut form_params: Vec<(&str, &str)> = vec![
        ("grant_type", "refresh_token"),
        ("client_id", trimmed_id),
        ("refresh_token", trimmed_refresh),
    ];
    if !trimmed_secret.is_empty() {
        form_params.push(("client_secret", trimmed_secret));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let res = client
        .post(GOOGLE_TOKEN_URL)
        .form(&form_params)
        .send()
        .await
        .map_err(|e| format!("Failed to refresh Google OAuth token: {e}"))?;

    let status = res.status();
    let body_text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Google OAuth token refresh failed ({status}): {body_text}"
        ));
    }

    let parsed: GoogleTokenResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse Google OAuth refresh response: {e}"))?;

    if let Some(err) = parsed.error.filter(|s| !s.trim().is_empty()) {
        let desc = parsed.error_description.unwrap_or(err);
        return Err(format!("Google OAuth refresh error: {desc}"));
    }

    let access_token = parsed
        .access_token
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Google OAuth refresh response did not include an access_token.".to_string())?;

    let expires_in = parsed.expires_in.unwrap_or(3600).max(60);
    let expires_at = Utc::now().timestamp() + expires_in;
    Ok((access_token, expires_at))
}

pub async fn get_valid_access_token(
    db: &Arc<StdMutex<Connection>>,
    client_id: &str,
    client_secret: &str,
) -> Result<String, String> {
    let stored = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        crate::db::load_google_oauth_tokens(&conn).map_err(|e| e.to_string())?
    };

    let tokens = stored.ok_or_else(|| {
        "Google OAuth is not connected. Sign in with Google in Settings.".to_string()
    })?;

    let now = Utc::now().timestamp();
    if !tokens.access_token.trim().is_empty() && tokens.expires_at > now + 60 {
        return Ok(tokens.access_token);
    }

    let (new_access, new_expires_at) =
        refresh_google_access_token(client_id, client_secret, &tokens.refresh_token).await?;

    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        crate::db::update_google_access_token(&conn, &new_access, new_expires_at)
            .map_err(|e| e.to_string())?;
    }

    Ok(new_access)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to_hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }

    #[test]
    fn test_sha256_nist_vectors() {
        assert_eq!(
            to_hex(&sha256(b"")),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            to_hex(&sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            to_hex(&sha256(
                b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
            )),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn test_base64url_encode_and_pkce_s256() {
        assert_eq!(base64url_encode(b""), "");
        assert_eq!(base64url_encode(b"f"), "Zg");
        assert_eq!(base64url_encode(b"fo"), "Zm8");
        assert_eq!(base64url_encode(b"foo"), "Zm9v");
        assert_eq!(base64url_encode(&[0xfb, 0xff, 0xbf]), "-_-_");

        // RFC 7636 Appendix B test vector
        let verifier = b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = base64url_encode(&sha256(verifier));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");

        let (v, c) = generate_pkce_pair();
        assert!(v.len() >= 64);
        assert!(!c.contains('='));
        assert!(!c.contains('+'));
        assert!(!c.contains('/'));
        assert_eq!(c, base64url_encode(&sha256(v.as_bytes())));
    }

    #[test]
    fn test_url_encode() {
        assert_eq!(
            url_encode("openid email https://www.googleapis.com/auth/generative-language"),
            "openid%20email%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgenerative-language"
        );
        assert_eq!(url_encode("abc-_.~123"), "abc-_.~123");
    }
}
