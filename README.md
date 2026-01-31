# react-devtools-mcp

Give AI agents eyes into your React app.

## Setup

### 1. Add MCP server to Claude Code

`.mcp.json`:
```json
{
  "mcpServers": {
    "react-devtools": {
      "command": "npx",
      "args": ["react-devtools-mcp"]
    }
  }
}
```

### 2. Connect your React app

**Web** - Add to your HTML (before your app bundle):
```html
<script src="http://localhost:8097"></script>
```

**React Native** - DevTools is built-in. No extra setup needed.

### 3. (Optional) Install the skill

Teach Claude when to use these tools:

```bash
npx add-skill skylarbarrera/react-devtools-mcp
```

Or manually:
```bash
cp node_modules/react-devtools-mcp/SKILL.md ~/.claude/skills/react-devtools/SKILL.md
```

## Usage

With your React app running, ask Claude things like:
- "What's the current state of the Counter component?"
- "Why doesn't clicking this button update the UI?"
- "Which components are re-rendering too often?"

## Docs

- [All tools](TOOLS.md)
- [Skill guide](SKILL.md) - When and how to use each tool

## License

MIT
