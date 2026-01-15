# MQTT MCP Server

An MCP (Model Context Protocol) server that enables Cursor to read messages from an MQTT broker.

## Features

- Subscribe to MQTT topics (supports wildcards `+` and `#`)
- Read buffered messages from subscribed topics
- List active subscriptions
- Configurable message buffer size

## Installation

1. Install dependencies:

```bash
npm install
```

2. Build the project:

```bash
npm run build
```

3. Copy `.env.example` to `.env` and configure your MQTT broker settings:

```bash
cp .env.example .env
```

## Configuration

Edit the `.env` file with your MQTT broker details:

| Variable | Description | Default |
|----------|-------------|---------|
| `MQTT_BROKER_URL` | MQTT broker URL (mqtt:// or mqtts://) | `mqtt://localhost:1883` |
| `MQTT_USERNAME` | Username for authentication | (none) |
| `MQTT_PASSWORD` | Password for authentication | (none) |
| `MQTT_CLIENT_ID` | Client ID for MQTT connection | `cursor-mqtt-mcp-{timestamp}` |
| `MAX_MESSAGES_PER_TOPIC` | Max messages to buffer per topic | `100` |

## Cursor Configuration

Add this MCP server to your Cursor settings (`.cursor/mcp.json` or global settings):

```json
{
  "mcpServers": {
    "mqtt": {
      "command": "node",
      "args": ["C:/path/to/mqtt-mcp/dist/index.js"],
      "env": {
        "MQTT_BROKER_URL": "mqtt://your-broker:1883",
        "MQTT_USERNAME": "your_username",
        "MQTT_PASSWORD": "your_password"
      }
    }
  }
}
```

Alternatively, if using a `.env` file in the project directory:

```json
{
  "mcpServers": {
    "mqtt": {
      "command": "node",
      "args": ["C:/path/to/mqtt-mcp/dist/index.js"],
      "cwd": "C:/path/to/mqtt-mcp"
    }
  }
}
```

## Available Tools

### mqtt_subscribe

Subscribe to an MQTT topic to start receiving messages.

**Parameters:**
- `topic` (required): The MQTT topic to subscribe to
- `qos` (optional): Quality of Service level (0, 1, or 2). Default: 0

**Example:**
```
Subscribe to "sensors/temperature"
Subscribe to "devices/+/status" (single-level wildcard)
Subscribe to "home/#" (multi-level wildcard)
```

### mqtt_unsubscribe

Unsubscribe from an MQTT topic.

**Parameters:**
- `topic` (required): The MQTT topic to unsubscribe from

### mqtt_read_messages

Read buffered messages from subscribed topics.

**Parameters:**
- `topic` (optional): Specific topic to read from. If omitted, reads from all topics
- `limit` (optional): Maximum messages to return. Default: 10
- `clear` (optional): Clear buffer after reading. Default: false

### mqtt_list_subscriptions

List all active subscriptions and their message counts.

**Parameters:** None

## Usage Example

1. First, subscribe to a topic:
   > "Subscribe to the MQTT topic sensors/temperature"

2. Wait for messages to arrive, then read them:
   > "Read the latest messages from sensors/temperature"

3. Check all active subscriptions:
   > "List my MQTT subscriptions"

4. Unsubscribe when done:
   > "Unsubscribe from sensors/temperature"

## License

MIT
