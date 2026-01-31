# Tools

## Connection

| Tool | Description |
|------|-------------|
| `connect` | Connect to DevTools backend |
| `disconnect` | Disconnect |
| `get_connection_status` | Check connection state |
| `health_check` | Server health status |

## Component Tree

| Tool | Description |
|------|-------------|
| `get_component_tree` | Get full component hierarchy |
| `get_element_by_id` | Get element info |
| `search_components` | Find components by name |
| `get_owners_list` | Get render chain (who rendered this) |
| `get_element_source` | Get source file location |

## Inspection

| Tool | Description |
|------|-------------|
| `inspect_element` | Get props, state, hooks, context |
| `get_native_style` | Get style info (React Native) |

## Mutation

| Tool | Description |
|------|-------------|
| `override_props` | Change a prop value |
| `override_state` | Change state (class components) |
| `override_hooks` | Change hook value (function components) |
| `override_context` | Change context value |
| `delete_path` | Delete a prop/state/hook/context path |
| `rename_path` | Rename a key |
| `set_native_style` | Set style (React Native) |

## Profiling

| Tool | Description |
|------|-------------|
| `start_profiling` | Start recording renders |
| `stop_profiling` | Stop and get profiling data |
| `get_profiling_data` | Get data without stopping |
| `get_profiling_status` | Check if profiling is active |

## Errors & Warnings

| Tool | Description |
|------|-------------|
| `get_errors_and_warnings` | Get all React errors/warnings |
| `clear_errors_and_warnings` | Clear errors/warnings |
| `toggle_error` | Force error boundary state |
| `toggle_suspense` | Force suspense state |

## UI Helpers

| Tool | Description |
|------|-------------|
| `highlight_element` | Highlight element in app |
| `clear_highlight` | Remove highlight |
| `scroll_to_element` | Scroll to show element |
| `log_to_console` | Log element as `$r` in console |
| `store_as_global` | Store value as global variable |
| `view_source` | Open source in IDE |

## Filters

| Tool | Description |
|------|-------------|
| `get_component_filters` | Get current filters |
| `set_component_filters` | Hide certain components |
| `set_trace_updates_enabled` | Toggle render highlighting |

## Native Inspection (React Native)

| Tool | Description |
|------|-------------|
| `start_inspecting_native` | Start tap-to-select mode |
| `stop_inspecting_native` | Stop inspection mode |
| `get_inspecting_native_status` | Check if inspecting |
| `capture_screenshot` | Screenshot an element |

## Advanced

| Tool | Description |
|------|-------------|
| `get_renderers` | List all React renderers |
| `get_renderer` | Get specific renderer |
| `get_elements_by_renderer` | Elements for a renderer |
| `get_capabilities` | Protocol capabilities |
| `view_attribute_source` | Source for specific attribute |
| `save_to_clipboard` | Copy to clipboard |
