import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Server,
  Terminal,
} from "lucide-react";
import type { BridgeSettings as BridgeSettingsData, BridgeStatus } from "../types";
import { DarkSelect, type DarkSelectOption } from "./DarkSelect";

interface BridgeSettingsProps {
  onStatusChange?: (status: BridgeStatus) => void;
  onSettingsSaved?: (settings: BridgeSettingsData) => void;
}

const DEV_MODEL_OPTIONS: DarkSelectOption[] = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "fable", label: "Fable" },
  { value: "", label: "Server default" },
];

const AGY_DEV_MODEL_OPTIONS: DarkSelectOption[] = [
  { value: "gemini-4-neon", label: "Gemini 4 Neon" },
  { value: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
  { value: "gemini-4-carbon", label: "Gemini 4 Carbon" },
  { value: "gemini-4-argon", label: "Gemini 4 Argon" },
  { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { value: "gemini-pro-orchestrator-neon", label: "Orchestrator (Neon)" },
  { value: "", label: "Server default" },
];

const DEV_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

const DEFAULT_RERANK_COMMAND =
  "cd /srv/repos/dealwire && ~/.local/bin/claude -p --model opus --effort high --allowedTools mcp__linear-pulse --output-format json";

const DEFAULT_AGY_RERANK_COMMAND =
  'cd /srv/repos/dealwire && ~/.local/bin/agy --model gemini-4-neon --effort high --dangerously-skip-permissions --output-format json -p "$(cat)"';

const DEFAULT_DEV_COMMAND =
  "cd /srv/repos/dealwire && ~/.local/bin/claude --bg --remote-control {name} -n {name} -w {slug} --permission-mode auto {prompt}";

const DEV_LAUNCH_MODE_OPTIONS: DarkSelectOption[] = [
  { value: "launcher", label: "Launcher (full tools)" },
  { value: "ssh", label: "SSH command line" },
];

const DEFAULT_DEV_ENVIRONMENT_ID = "env_01D4f9186hqvLzMnvpSk5Xz5";

const DEFAULT_SETTINGS: BridgeSettingsData = {
  server_enabled: false,
  port: 47100,
  token: "",
  tunnel_enabled: false,
  ssh_target: "",
  remote_port: 47100,
  rerank_ssh_target: "",
  rerank_command: DEFAULT_RERANK_COMMAND,
  dev_command: DEFAULT_DEV_COMMAND,
  dev_model: "opus",
  dev_effort: "high",
  dev_launch_mode: "launcher",
  dev_environment_id: DEFAULT_DEV_ENVIRONMENT_ID,
  dev_provider: "claude",
  agy_dev_model: "gemini-4-neon",
  agy_dev_effort: "high",
  agy_repo_path: "/srv/repos/dealwire",
  rerank_provider: "claude",
  agy_rerank_command: DEFAULT_AGY_RERANK_COMMAND,
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleString();
}

export function BridgeSettings({
  onStatusChange,
  onSettingsSaved,
}: BridgeSettingsProps) {
  const [settings, setSettings] = useState<BridgeSettingsData>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [loaded, st] = await Promise.all([
          invoke<BridgeSettingsData>("get_bridge_settings"),
          invoke<BridgeStatus>("get_bridge_status"),
        ]);
        if (!active) return;
        setSettings(loaded);
        setStatus(st);
        onStatusChange?.(st);
      } catch (err) {
        if (active) setError(String(err));
      } finally {
        if (active) setLoading(false);
      }
    })();

    const poll = setInterval(async () => {
      try {
        const st = await invoke<BridgeStatus>("get_bridge_status");
        if (active) {
          setStatus(st);
          onStatusChange?.(st);
        }
      } catch {
        // Ignore poll failure
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [onStatusChange]);

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      setTimeout(() => {
        setCopiedField((curr) => (curr === key ? null : curr));
      }, 1500);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  async function handleSave() {
    setError(null);
    setSavedMsg(null);
    setSaving(true);
    try {
      const payload: BridgeSettingsData = {
        ...settings,
        port: Number(settings.port) || 47100,
        remote_port: Number(settings.remote_port) || 47100,
      };
      const nextStatus = await invoke<BridgeStatus>("save_bridge_settings", {
        settings: payload,
      });
      const savedSettings = await invoke<BridgeSettingsData>(
        "get_bridge_settings"
      );
      setSettings(savedSettings);
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      onSettingsSaved?.(savedSettings);
      setSavedMsg("Bridge settings applied.");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateToken() {
    setError(null);
    setSavedMsg(null);
    setRegenerating(true);
    try {
      const updated = await invoke<BridgeSettingsData>("regenerate_bridge_token");
      setSettings(updated);
      setConfirmRegenerate(false);
      const nextStatus = await invoke<BridgeStatus>("get_bridge_status");
      setStatus(nextStatus);
      onStatusChange?.(nextStatus);
      setSavedMsg("Bearer token regenerated.");
    } catch (err) {
      setError(String(err));
    } finally {
      setRegenerating(false);
    }
  }

  const effectiveRemotePort = Number(settings.remote_port) || 47100;
  const effectiveToken = settings.token || "<token>";
  const claudeCmd = `claude mcp add --transport http --scope user linear-pulse http://localhost:${effectiveRemotePort}/mcp --header "Authorization: Bearer ${effectiveToken}"`;
  const agyCmd = `agy mcp add --type http --header "Authorization: Bearer ${effectiveToken}" linear-pulse http://localhost:${effectiveRemotePort}/mcp`;
  const healthCmd = `curl -s http://localhost:${effectiveRemotePort}/health`;
  const sshHintTarget = settings.ssh_target.trim() || "deploy@your-server";

  const agyDevModelOptions =
    !settings.agy_dev_model ||
    AGY_DEV_MODEL_OPTIONS.some((o) => o.value === settings.agy_dev_model)
      ? AGY_DEV_MODEL_OPTIONS
      : [
          { value: settings.agy_dev_model, label: settings.agy_dev_model },
          ...AGY_DEV_MODEL_OPTIONS,
        ];

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 dark:border-white/10 dark:bg-[#090B10]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            <Server className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            Agent Bridge (Claude Code & Antigravity · MCP + SSH Tunnel)
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            Expose your local backlog over an authenticated MCP HTTP server and
            reverse SSH tunnel.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading || saving}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-200">
          {error}
        </div>
      )}

      {savedMsg && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300">
          {savedMsg}
        </div>
      )}

      {/* MCP Server */}
      <div className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3 dark:border-white/8 dark:bg-[#10131B]">
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={settings.server_enabled}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  server_enabled: e.target.checked,
                }))
              }
              className="h-3.5 w-3.5 rounded border-zinc-400 bg-white accent-indigo-600 dark:border-zinc-600 dark:bg-zinc-900 dark:accent-indigo-500"
            />
            Enable local MCP HTTP server
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-500">Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={settings.port}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  port: Number(e.target.value) || 47100,
                }))
              }
              className="w-20 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Bearer Token
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type={showToken ? "text" : "password"}
              readOnly
              value={settings.token}
              className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[11px] text-zinc-900 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-200"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              title={showToken ? "Hide token" : "Show token"}
              className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:bg-[#1B202D]"
            >
              {showToken ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void copyText("token", settings.token)}
              title="Copy token"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:bg-[#1B202D]"
            >
              {copiedField === "token" ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              Copy
            </button>
            {confirmRegenerate ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={regenerating}
                  onClick={() => void handleRegenerateToken()}
                  className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1.5 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200"
                >
                  {regenerating ? "..." : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRegenerate(false)}
                  className="rounded-md border border-zinc-200 px-2 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRegenerate(true)}
                title="Regenerate bearer token"
                className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[11px] font-medium text-zinc-700 transition hover:border-amber-400 hover:text-zinc-900 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:border-amber-500/40"
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SSH Tunnel */}
      <div className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3 dark:border-white/8 dark:bg-[#10131B]">
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-900 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={settings.tunnel_enabled}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  tunnel_enabled: e.target.checked,
                }))
              }
              className="h-3.5 w-3.5 rounded border-zinc-400 bg-white accent-indigo-600 dark:border-zinc-600 dark:bg-zinc-900 dark:accent-indigo-500"
            />
            Enable SSH reverse tunnel
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-500">Remote port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={settings.remote_port}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  remote_port: Number(e.target.value) || 47100,
                }))
              }
              className="w-20 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            SSH Target
          </label>
          <input
            type="text"
            value={settings.ssh_target}
            onChange={(e) =>
              setSettings((s) => ({ ...s, ssh_target: e.target.value }))
            }
            placeholder="deploy@your-server"
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </div>
      </div>

      {/* Rerank & Dev Sessions */}
      <div className="space-y-2.5 rounded-lg border border-zinc-200 bg-white p-3 dark:border-white/8 dark:bg-[#10131B]">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
            Rerank
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
              Rerank engine
            </span>
            <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-white/10 dark:bg-[#090B10]">
              {(
                [
                  { id: "claude", label: "Claude Code" },
                  { id: "antigravity", label: "Antigravity" },
                ] as const
              ).map((opt) => {
                const active =
                  (settings.rerank_provider || "claude") === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      setSettings((s) => ({ ...s, rerank_provider: opt.id }))
                    }
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                      active
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            Rerank SSH Target
          </label>
          <input
            type="text"
            value={settings.rerank_ssh_target}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                rerank_ssh_target: e.target.value,
              }))
            }
            placeholder={
              settings.ssh_target.trim() || "Same as tunnel SSH target"
            }
            className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
        </div>

        {(settings.rerank_provider || "claude") === "antigravity" ? (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Antigravity Rerank Command
            </label>
            <input
              type="text"
              value={settings.agy_rerank_command}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  agy_rerank_command: e.target.value,
                }))
              }
              placeholder={DEFAULT_AGY_RERANK_COMMAND}
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Rerank Command
            </label>
            <input
              type="text"
              value={settings.rerank_command}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  rerank_command: e.target.value,
                }))
              }
              placeholder={DEFAULT_RERANK_COMMAND}
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Runs on your server over SSH with this computer&apos;s key. The SSH
          user must have{" "}
          {(settings.rerank_provider || "claude") === "antigravity"
            ? "Antigravity (agy)"
            : "Claude Code"}{" "}
          installed and the{" "}
          <code className="rounded bg-zinc-100 px-1 font-mono text-zinc-700 dark:bg-white/[0.06] dark:text-zinc-300">
            linear-pulse
          </code>{" "}
          MCP server registered. The prompt is passed on stdin.
        </p>

        <div className="space-y-2.5 border-t border-zinc-200/80 pt-2.5 dark:border-white/8">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
              Dev sessions
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                Default agent
              </span>
              <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-white/10 dark:bg-[#090B10]">
                {(
                  [
                    { id: "claude", label: "Claude Code" },
                    { id: "antigravity", label: "Antigravity" },
                  ] as const
                ).map((opt) => {
                  const active = (settings.dev_provider || "claude") === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        setSettings((s) => ({ ...s, dev_provider: opt.id }))
                      }
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                        active
                          ? "bg-indigo-600 text-white shadow-xs"
                          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Start sessions with
              </label>
              <DarkSelect
                value={settings.dev_launch_mode}
                options={DEV_LAUNCH_MODE_OPTIONS}
                onChange={(val) =>
                  setSettings((s) => ({ ...s, dev_launch_mode: val }))
                }
                fullWidth
                compact
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Environment id
              </label>
              <input
                type="text"
                value={settings.dev_environment_id}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    dev_environment_id: e.target.value,
                  }))
                }
                placeholder={DEFAULT_DEV_ENVIRONMENT_ID}
                className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                Cloud environment the launcher starts sessions in.
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
              Dev sessions
            </label>
            <input
              type="text"
              value={settings.dev_command}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  dev_command: e.target.value,
                }))
              }
              placeholder={DEFAULT_DEV_COMMAND}
              className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Starts a background Claude Code session with Remote Control on
              your server (same SSH target as Rerank). {"{name}"}, {"{slug}"},
              {" {model_flags}"} and {"{prompt}"} are filled in by the app; the
              prompt is passed base64-encoded.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Default model
              </label>
              <DarkSelect
                value={settings.dev_model}
                options={DEV_MODEL_OPTIONS}
                onChange={(val) =>
                  setSettings((s) => ({ ...s, dev_model: val }))
                }
                fullWidth
                compact
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Default effort
              </label>
              <div className="grid grid-cols-5 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-[#090B10]">
                {DEV_EFFORT_LEVELS.map((level) => {
                  const active = settings.dev_effort === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() =>
                        setSettings((s) => ({ ...s, dev_effort: level }))
                      }
                      className={`py-1 text-center text-[10px] font-medium transition ${
                        active
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.06]"
                      }`}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Antigravity dev sessions */}
          <div className="space-y-2.5 border-t border-zinc-200/80 pt-2.5 dark:border-white/8">
            <div className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
              Antigravity dev sessions
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Repository path on server
              </label>
              <input
                type="text"
                value={settings.agy_repo_path}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, agy_repo_path: e.target.value }))
                }
                placeholder="/srv/repos/dealwire"
                className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Antigravity default model
                </label>
                <DarkSelect
                  value={settings.agy_dev_model}
                  options={agyDevModelOptions}
                  onChange={(val) =>
                    setSettings((s) => ({ ...s, agy_dev_model: val }))
                  }
                  fullWidth
                  compact
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Antigravity default effort
                </label>
                <div className="grid grid-cols-5 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-[#090B10]">
                  {DEV_EFFORT_LEVELS.map((level) => {
                    const active = settings.agy_dev_effort === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() =>
                          setSettings((s) => ({ ...s, agy_dev_effort: level }))
                        }
                        className={`py-1 text-center text-[10px] font-medium transition ${
                          active
                            ? "bg-indigo-600 text-white"
                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.06]"
                        }`}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Runs{" "}
              <code className="rounded bg-zinc-100 px-1 font-mono text-zinc-700 dark:bg-white/[0.06] dark:text-zinc-300">
                ~/.local/bin/lp-agy-start
              </code>{" "}
              in an isolated git worktree with Remote Control enabled over SSH.
            </p>
          </div>
        </div>
      </div>

      {/* Status Block */}
      {status && (
        <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white p-3 text-[11px] dark:border-white/8 dark:bg-[#10131B]">
          <div className="font-semibold uppercase tracking-wider text-zinc-500">
            Live Status
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-zinc-700 dark:text-zinc-300">
            <div>
              MCP Server:{" "}
              <span
                className={`font-medium ${
                  status.server_error
                    ? "text-rose-600 dark:text-rose-400"
                    : status.server_running
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-500"
                }`}
              >
                {status.server_running
                  ? `Running (127.0.0.1:${status.port})`
                  : status.server_error
                  ? "Error"
                  : "Stopped"}
              </span>
            </div>
            <div>
              Tunnel:{" "}
              <span
                className={`font-medium ${
                  status.tunnel_state === "connected"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : status.tunnel_state === "error"
                    ? "text-rose-600 dark:text-rose-400"
                    : status.tunnel_state === "connecting"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-zinc-500"
                }`}
              >
                {status.tunnel_state}
              </span>
            </div>
            <div>
              Last MCP call:{" "}
              <span className="font-mono text-zinc-600 dark:text-zinc-400">
                {formatTimestamp(status.last_request_at)}
              </span>
            </div>
            <div>
              Tunnel since:{" "}
              <span className="font-mono text-zinc-600 dark:text-zinc-400">
                {status.tunnel_since ? formatTimestamp(status.tunnel_since) : "—"}
              </span>
            </div>
          </div>
          {status.server_error && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400">
              Server error: {status.server_error}
            </p>
          )}
          {status.tunnel_error && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400">
              Tunnel error: {status.tunnel_error}
            </p>
          )}
        </div>
      )}

      {/* Connect agents on the server */}
      <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-white/8 dark:bg-[#10131B]">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
          <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          Connect agents on the server
        </div>

        <div className="flex items-start gap-1.5">
          <code className="block min-w-0 flex-1 overflow-x-auto rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-800 dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-200">
            {claudeCmd}
          </code>
          <button
            type="button"
            onClick={() => void copyText("claudeCmd", claudeCmd)}
            className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200"
          >
            {copiedField === "claudeCmd" ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="flex items-start gap-1.5">
          <code className="block min-w-0 flex-1 overflow-x-auto rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-zinc-800 dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-200">
            {agyCmd}
          </code>
          <button
            type="button"
            onClick={() => void copyText("agyCmd", agyCmd)}
            className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200"
          >
            {copiedField === "agyCmd" ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <code className="block min-w-0 flex-1 overflow-x-auto rounded border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-mono text-[10px] text-zinc-700 dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-300">
            {healthCmd}
          </code>
          <button
            type="button"
            onClick={() => void copyText("healthCmd", healthCmd)}
            className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[10px] font-medium text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200"
          >
            {copiedField === "healthCmd" ? "Copied" : "Copy"}
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
          Note: the tunnel uses this computer&apos;s SSH keys non-interactively
          (BatchMode). Run{" "}
          <code className="rounded bg-zinc-100 px-1 font-mono text-zinc-700 dark:bg-white/[0.06] dark:text-zinc-300">
            ssh {sshHintTarget}
          </code>{" "}
          once in a terminal first so the key is loaded and the host is known.
        </p>
      </div>
    </div>
  );
}
