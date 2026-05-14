use std::io::{self, BufRead, Write};
use std::sync::{mpsc, Arc};
use std::thread;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use yap_core_lib::commands::{self, CommandHost};
use yap_core_lib::config::AppConfig;
use yap_core_lib::dictation::{self, DictationHost};

#[derive(Debug, Deserialize)]
struct RpcRequest {
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    #[allow(dead_code)]
    r#type: Option<String>,
    #[serde(alias = "command")]
    method: String,
    #[serde(default, alias = "args")]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum RpcOutput {
    Response {
        id: Option<Value>,
        ok: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Event {
        event: &'static str,
        payload: Value,
    },
}

#[derive(Clone)]
struct SidecarHost {
    output: mpsc::Sender<RpcOutput>,
}

impl CommandHost for SidecarHost {
    fn on_settings_changed(&self) {
        if dictation::is_running() {
            let host: Arc<dyn DictationHost> = Arc::new(self.clone());
            if let Err(error) = dictation::start(host) {
                let _ = self.output.send(RpcOutput::Event {
                    event: "dictation:error",
                    payload: json!({
                        "title": "Settings update failed",
                        "message": error,
                    }),
                });
            }
        }
    }

    fn hotkey_capture_preview(&self, shortcut: String) {
        let _ = self.output.send(RpcOutput::Event {
            event: "settings:hotkey-preview",
            payload: json!(shortcut),
        });
    }

    fn hotkey_capture_captured(&self, shortcut: String) {
        let _ = self.output.send(RpcOutput::Event {
            event: "settings:hotkey-captured",
            payload: json!(shortcut),
        });
    }
}

impl DictationHost for SidecarHost {
    fn emit(&self, event: &'static str, payload: Value) {
        let _ = self.output.send(RpcOutput::Event { event, payload });
    }
}

fn main() {
    let (output_tx, output_rx) = mpsc::channel::<RpcOutput>();
    let writer = thread::spawn(move || {
        let stdout = io::stdout();
        let mut stdout = stdout.lock();
        while let Ok(output) = output_rx.recv() {
            match serde_json::to_writer(&mut stdout, &output) {
                Ok(()) => {
                    let _ = stdout.write_all(b"\n");
                    let _ = stdout.flush();
                }
                Err(_) => break,
            }
        }
    });

    let host = Arc::new(SidecarHost {
        output: output_tx.clone(),
    });

    for line in io::stdin().lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                let _ = output_tx.send(error_response(
                    None,
                    format!("failed to read request line: {err}"),
                ));
                continue;
            }
        };

        if line.trim().is_empty() {
            continue;
        }

        let request = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => request,
            Err(err) => {
                let _ =
                    output_tx.send(error_response(None, format!("invalid request JSON: {err}")));
                continue;
            }
        };

        let id = request.id.clone();
        let response = match handle_request(request, Arc::clone(&host)) {
            Ok(result) => success_response(id, result),
            Err(err) => error_response(id, err),
        };
        let _ = output_tx.send(response);
    }

    let _ = dictation::stop();
    drop(host);
    drop(output_tx);
    let _ = writer.join();
}

fn handle_request(request: RpcRequest, host: Arc<SidecarHost>) -> Result<Option<Value>, String> {
    match request.method.as_str() {
        "config.get" => to_value(commands::load_config()?).map(Some),
        "config.save" => {
            let config = parse_config_params(request.params)?;
            commands::store_config(config, host.as_ref())?;
            Ok(Some(json!({ "saved": true })))
        }
        "history.get" => to_value(commands::load_history()).map(Some),
        "history.remove" => {
            let id = required_string_param(request.params, "id")?;
            commands::delete_history_entry(&id)?;
            Ok(Some(json!({ "removed": true })))
        }
        "history.clear" => {
            commands::delete_all_history()?;
            Ok(Some(json!({ "cleared": true })))
        }
        "audio.list_devices" => {
            to_value(commands::audio_device_names()).map(Some)
        }
        "hotkey_capture.start" => {
            let host: Arc<dyn CommandHost> = host;
            commands::begin_hotkey_capture(host);
            Ok(Some(json!({ "started": true })))
        }
        "hotkey_capture.cancel" => {
            commands::stop_hotkey_capture();
            Ok(Some(json!({ "cancelled": true })))
        }
        "runtime.start" => {
            let host: Arc<dyn DictationHost> = host;
            dictation::start(host)?;
            Ok(Some(json!({ "started": true })))
        }
        "runtime.stop" => {
            dictation::stop()?;
            Ok(Some(json!({ "stopped": true })))
        }
        other => Err(format!("unknown method: {other}")),
    }
}

fn parse_config_params(params: Option<Value>) -> Result<AppConfig, String> {
    let params = params.ok_or_else(|| "missing params".to_string())?;
    let config_value = params
        .get("cfg")
        .or_else(|| params.get("config"))
        .cloned()
        .unwrap_or(params);
    serde_json::from_value::<AppConfig>(config_value)
        .map_err(|err| format!("invalid config params: {err}"))
}

fn required_string_param(params: Option<Value>, key: &str) -> Result<String, String> {
    let params = params.ok_or_else(|| "missing params".to_string())?;
    params
        .get(key)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("missing string param: {key}"))
}

fn to_value<T: Serialize>(result: T) -> Result<Value, String> {
    serde_json::to_value(result).map_err(|err| format!("failed to serialize response: {err}"))
}

fn success_response(id: Option<Value>, result: Option<Value>) -> RpcOutput {
    RpcOutput::Response {
        id,
        ok: true,
        result,
        error: None,
    }
}

fn error_response(id: Option<Value>, error: String) -> RpcOutput {
    RpcOutput::Response {
        id,
        ok: false,
        result: None,
        error: Some(error),
    }
}
