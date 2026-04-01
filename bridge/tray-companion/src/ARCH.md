# bridge/tray-companion/src
Rust implementation of the native tray process.
The tray should only mirror runtime truth from the bridge control server and request safe shutdown; it should not own binding or relay logic.
Keep platform-specific UI code here and keep business logic in the Node bridge.
一旦我所属的文件夹有所变化，请更新我。

| file name | position | function |
| --- | --- | --- |
| `main.rs` | tray entrypoint | Runs the native event loop, handles menu clicks, and requests shutdown/status refreshes. |
| `bridge_status.rs` | status adapter | Fetches and normalizes bridge runtime status from the localhost control server. |
| `menu_model.rs` | presentation helper | Maps runtime status into tray labels and menu sections. |
