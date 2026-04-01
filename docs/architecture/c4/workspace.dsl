workspace "codex-chat-bridge" "Codex thread handoff bridge for external chat channels" {
    model {
        person codex_user "Codex user" "Starts attach/detach flows from Codex or Telegram."

        softwareSystem bridge_system "Codex Chat Bridge" "Install-first bridge that relays one Codex thread into an external chat channel." {
            container codex_skill "Codex skill" "Markdown skill package" "Triggers attach/recovery/detach flows from inside Codex."
            container bridge_daemon "Bridge daemon" "Node.js" "Owns Telegram polling, binding state, relay queues, permission overrides, and shutdown mode."
            container tray_companion "Tray companion" "Rust" "Shows runtime status and requests safe shutdown from the OS tray."
            container local_state "Local state store" "JSON files" "Stores active bindings, polling offset, and light runtime metadata."
            container telegram_api "Telegram Bot API" "External HTTP API" "Delivers bot updates and accepts outgoing messages."
            container codex_app_server "Codex app-server" "JSON-RPC subprocess" "Resumes threads and starts turns against Codex."
        }

        codex_user -> codex_skill "Uses"
        codex_skill -> bridge_daemon "Invokes local commands"
        bridge_daemon -> telegram_api "Polls updates and sends messages"
        bridge_daemon -> codex_app_server "Resumes threads and relays turns"
        bridge_daemon -> local_state "Reads and writes bindings and offsets"
        tray_companion -> bridge_daemon "Reads runtime status and requests shutdown"

        component bridge_runtime "Bridge runtime" "bridge/src/bridge-service.mjs" "Coordinates bindings, relay workers, shutdown mode, and access updates."
        component cli_entrypoint "CLI entrypoint" "bridge/src/cli.mjs" "Starts/stops the daemon and runs attach/detach/status commands."
        component codex_client "Codex client adapter" "bridge/src/codex-app-server.mjs" "Implements the app-server JSON-RPC bridge."
        component telegram_transport "Telegram transport" "bridge/src/telegram-api.mjs" "Wraps Bot API calls."
        component binding_store "Binding store" "bridge/src/binding-store.mjs" "Persists binding and polling state."
        component control_plane "Control server" "bridge/src/control-server.mjs" "Exposes health, status, and shutdown endpoints."

        bridge_daemon -> bridge_runtime "Runs"
        bridge_daemon -> cli_entrypoint "Starts from"
        bridge_runtime -> codex_client "Uses"
        bridge_runtime -> telegram_transport "Uses"
        bridge_runtime -> binding_store "Uses"
        bridge_runtime -> control_plane "Exposes status through"
    }

    views {
        systemContext bridge_system "system" {
            include *
            autolayout lr
        }

        container bridge_system "containers" {
            include *
            autolayout lr
        }

        component bridge_daemon "bridge_runtime_components" {
            include bridge_runtime
            include cli_entrypoint
            include codex_client
            include telegram_transport
            include binding_store
            include control_plane
            autolayout lr
        }

        theme default
    }
}
