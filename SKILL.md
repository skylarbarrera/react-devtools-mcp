---
name: react-devtools
description: Debug React apps by inspecting runtime state, props, hooks, and renders
---

# React DevTools

Inspect running React apps. See actual props, state, hooks - not just source code.

## When to Use

**Use these tools when:**
- User says "why doesn't this update" or "state is wrong"
- Behavior doesn't match what code suggests
- Need to verify actual runtime values
- Debugging performance / excessive renders
- Exploring unfamiliar React codebase

**Don't use when:**
- Bug is obvious from source (missing dep, typo)
- Just need to read/edit files
- No React app is running

## Setup Check

Before using, ensure:
1. MCP server is configured in `.mcp.json`
2. React app is running with DevTools connected

## Core Workflow

### 1. Connect
```
connect()
```

### 2. Find the component
```
search_components({ query: "ComponentName" })
```
or
```
get_component_tree()
```

### 3. Inspect it
```
inspect_element({ id: <element_id> })
```

Returns: `{ props, state, hooks, context }`

## Common Debugging Patterns

### "Why doesn't clicking X update Y?"
```
1. search_components({ query: "ButtonComponent" })
2. inspect_element({ id }) → check state/props
3. Compare actual values vs expected
```

### "This component re-renders too much"
```
1. start_profiling()
2. [user interacts with app]
3. stop_profiling() → see render counts and timing
```

### "What's the actual value of this state?"
```
1. search_components({ query: "ComponentName" })
2. inspect_element({ id })
3. Look at hooks[].value for useState values
```

### "Who renders this component?"
```
get_owners_list({ id }) → shows parent chain
```

## Key Tools

| Tool | Use For |
|------|---------|
| `inspect_element` | See props, state, hooks, context |
| `search_components` | Find component by name |
| `get_component_tree` | See full hierarchy |
| `get_owners_list` | Trace render chain |
| `start/stop_profiling` | Measure render performance |
| `highlight_element` | Visually identify component in app |

## Tips

- Element IDs change on hot reload - re-search after code changes
- Use `highlight_element` to confirm you're looking at the right component
- Hooks are indexed - `hooks[0]` is first useState/useEffect in component
