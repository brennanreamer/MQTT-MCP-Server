import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import mqtt, { MqttClient } from "mqtt";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file in project root
const envPath = path.resolve(__dirname, "..", ".env");
dotenv.config({ path: envPath });
console.error(`Loading .env from: ${envPath}`);

// Configuration from environment
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_CLIENT_ID = process.env.MQTT_CLIENT_ID || `cursor-mqtt-mcp-${Date.now()}`;
const MAX_MESSAGES_PER_TOPIC = parseInt(process.env.MAX_MESSAGES_PER_TOPIC || "100", 10);

// Types
interface MqttMessage {
  topic: string;
  payload: string;
  timestamp: Date;
  qos: number;
  retain: boolean;
}

// Message buffer - stores messages per topic
const messageBuffer: Map<string, MqttMessage[]> = new Map();

// Active subscriptions
const subscriptions: Set<string> = new Set();

// MQTT Client
let mqttClient: MqttClient | null = null;

// Initialize MQTT connection
function connectMqtt(): Promise<MqttClient> {
  return new Promise((resolve, reject) => {
    const options: mqtt.IClientOptions = {
      clientId: MQTT_CLIENT_ID,
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 5000,
    };

    if (MQTT_USERNAME) {
      options.username = MQTT_USERNAME;
    }
    if (MQTT_PASSWORD) {
      options.password = MQTT_PASSWORD;
    }

    const client = mqtt.connect(MQTT_BROKER_URL, options);

    client.on("connect", () => {
      console.error(`Connected to MQTT broker: ${MQTT_BROKER_URL}`);
      resolve(client);
    });

    client.on("error", (err) => {
      const errAny = err as Error & { code?: string | number };
      const errorDetails = errAny.code 
        ? `${errAny.code}: ${errAny.message || 'Unknown error'}`
        : errAny.message || JSON.stringify(err) || 'Unknown error';
      console.error(`MQTT connection error: ${errorDetails}`);
      console.error(`Broker URL: ${MQTT_BROKER_URL}`);
      reject(new Error(`MQTT error: ${errorDetails}`));
    });

    client.on("message", (topic, payload, packet) => {
      const message: MqttMessage = {
        topic,
        payload: payload.toString(),
        timestamp: new Date(),
        qos: packet.qos,
        retain: packet.retain,
      };

      // Add to buffer
      if (!messageBuffer.has(topic)) {
        messageBuffer.set(topic, []);
      }
      const topicMessages = messageBuffer.get(topic)!;
      topicMessages.push(message);

      // Trim buffer if it exceeds max size
      if (topicMessages.length > MAX_MESSAGES_PER_TOPIC) {
        topicMessages.shift();
      }
    });

    client.on("reconnect", () => {
      console.error(`Reconnecting to MQTT broker at ${MQTT_BROKER_URL}...`);
    });

    client.on("offline", () => {
      console.error(`MQTT client offline. Broker: ${MQTT_BROKER_URL}`);
    });

    client.on("close", () => {
      console.error("MQTT connection closed");
    });
  });
}

// Ensure MQTT client is connected
async function ensureConnected(): Promise<MqttClient> {
  if (!mqttClient || !mqttClient.connected) {
    mqttClient = await connectMqtt();
  }
  return mqttClient;
}

// Check if a topic matches an MQTT wildcard pattern
function topicMatchesPattern(topic: string, pattern: string): boolean {
  // Exact match
  if (topic === pattern) {
    return true;
  }

  const topicParts = topic.split("/");
  const patternParts = pattern.split("/");

  let topicIndex = 0;
  let patternIndex = 0;

  while (patternIndex < patternParts.length) {
    const patternPart = patternParts[patternIndex];

    if (patternPart === "#") {
      // '#' matches everything from here to the end
      return true;
    }

    if (topicIndex >= topicParts.length) {
      // Topic has fewer parts than pattern (and pattern isn't '#')
      return false;
    }

    if (patternPart === "+") {
      // '+' matches exactly one level
      topicIndex++;
      patternIndex++;
    } else if (patternPart === topicParts[topicIndex]) {
      // Exact match for this level
      topicIndex++;
      patternIndex++;
    } else {
      // No match
      return false;
    }
  }

  // Pattern exhausted - topic should also be exhausted for a match
  return topicIndex === topicParts.length;
}

// Get all topics from the buffer that match a pattern (including wildcards)
function getMatchingTopics(pattern: string): string[] {
  const matchingTopics: string[] = [];
  
  for (const topic of messageBuffer.keys()) {
    if (topicMatchesPattern(topic, pattern)) {
      matchingTopics.push(topic);
    }
  }
  
  return matchingTopics;
}

// Tool definitions
const tools: Tool[] = [
  {
    name: "mqtt_subscribe",
    description:
      "Subscribe to an MQTT topic to start receiving messages. Supports MQTT wildcards: '+' for single level, '#' for multi-level.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The MQTT topic to subscribe to (e.g., 'sensors/temperature' or 'sensors/+/status')",
        },
        qos: {
          type: "number",
          description: "Quality of Service level (0, 1, or 2). Default is 0.",
          enum: [0, 1, 2],
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "mqtt_unsubscribe",
    description: "Unsubscribe from an MQTT topic to stop receiving messages.",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The MQTT topic to unsubscribe from",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "mqtt_read_messages",
    description:
      "Read buffered messages from a subscribed topic. Returns the most recent messages received since subscribing. Supports MQTT wildcards: '+' for single level, '#' for multi-level (e.g., 'sensors/#' returns messages from all topics under 'sensors/').",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The MQTT topic to read messages from. Supports wildcards (+, #) to read from multiple matching topics. If not provided, returns messages from all subscribed topics.",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return. Default is 10. Set to 0 or omit to return all messages.",
        },
        clear: {
          type: "boolean",
          description: "Whether to clear the message buffer after reading. Default is false.",
        },
      },
    },
  },
  {
    name: "mqtt_list_subscriptions",
    description: "List all active MQTT topic subscriptions and their message counts.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Tool handlers
async function handleSubscribe(topic: string, qos: number = 0): Promise<string> {
  const client = await ensureConnected();

  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: qos as 0 | 1 | 2 }, (err, granted) => {
      if (err) {
        reject(new Error(`Failed to subscribe to ${topic}: ${err.message}`));
        return;
      }

      subscriptions.add(topic);
      if (!messageBuffer.has(topic)) {
        messageBuffer.set(topic, []);
      }

      const grantedQos = granted?.[0]?.qos ?? qos;
      resolve(`Successfully subscribed to topic '${topic}' with QoS ${grantedQos}`);
    });
  });
}

async function handleUnsubscribe(topic: string): Promise<string> {
  const client = await ensureConnected();

  return new Promise((resolve, reject) => {
    client.unsubscribe(topic, (err) => {
      if (err) {
        reject(new Error(`Failed to unsubscribe from ${topic}: ${err.message}`));
        return;
      }

      subscriptions.delete(topic);
      messageBuffer.delete(topic);
      resolve(`Successfully unsubscribed from topic '${topic}'`);
    });
  });
}

async function handleReadMessages(
  topic?: string,
  limit: number = 10,
  clear: boolean = false
): Promise<string> {
  await ensureConnected();

  let messages: MqttMessage[] = [];
  const returnAll = limit === 0;

  if (topic) {
    // Check if the topic contains wildcards
    const hasWildcard = topic.includes("+") || topic.includes("#");
    
    if (hasWildcard) {
      // Find all topics that match the wildcard pattern
      const matchingTopics = getMatchingTopics(topic);
      
      for (const matchedTopic of matchingTopics) {
        const topicMessages = messageBuffer.get(matchedTopic) || [];
        messages.push(...topicMessages);
      }
      
      // Sort by timestamp
      messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      // Apply limit only if not returning all
      if (!returnAll) {
        messages = messages.slice(-limit);
      }
      
      if (clear) {
        for (const matchedTopic of matchingTopics) {
          messageBuffer.set(matchedTopic, []);
        }
      }
    } else {
      // Read from specific topic (exact match)
      const topicMessages = messageBuffer.get(topic) || [];
      messages = returnAll ? topicMessages : topicMessages.slice(-limit);

      if (clear) {
        messageBuffer.set(topic, []);
      }
    }
  } else {
    // Read from all topics
    for (const [t, topicMessages] of messageBuffer.entries()) {
      messages.push(...topicMessages);
    }
    // Sort by timestamp
    messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    // Apply limit only if not returning all
    if (!returnAll) {
      messages = messages.slice(-limit);
    }

    if (clear) {
      for (const t of messageBuffer.keys()) {
        messageBuffer.set(t, []);
      }
    }
  }

  if (messages.length === 0) {
    return topic
      ? `No messages received on topic '${topic}' yet.`
      : "No messages received on any subscribed topics yet.";
  }

  const formattedMessages = messages.map((m) => ({
    topic: m.topic,
    payload: m.payload,
    timestamp: m.timestamp.toISOString(),
    qos: m.qos,
    retain: m.retain,
  }));

  return JSON.stringify(formattedMessages, null, 2);
}

async function handleListSubscriptions(): Promise<string> {
  await ensureConnected();

  const subscriptionList = Array.from(subscriptions).map((topic) => {
    const hasWildcard = topic.includes("+") || topic.includes("#");
    
    if (hasWildcard) {
      // Count messages from all matching topics
      const matchingTopics = getMatchingTopics(topic);
      const totalMessages = matchingTopics.reduce((sum, t) => {
        return sum + (messageBuffer.get(t)?.length || 0);
      }, 0);
      
      return {
        topic,
        messageCount: totalMessages,
        matchingTopics: matchingTopics.length,
      };
    } else {
      return {
        topic,
        messageCount: messageBuffer.get(topic)?.length || 0,
      };
    }
  });

  if (subscriptionList.length === 0) {
    return "No active subscriptions.";
  }

  return JSON.stringify(subscriptionList, null, 2);
}

// Create and configure the MCP server
const server = new Server(
  {
    name: "mqtt-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "mqtt_subscribe":
        result = await handleSubscribe(
          args?.topic as string,
          (args?.qos as number) ?? 0
        );
        break;

      case "mqtt_unsubscribe":
        result = await handleUnsubscribe(args?.topic as string);
        break;

      case "mqtt_read_messages":
        const limitArg = args?.limit as number | undefined;
        // If limit is 0, return all messages; if undefined, use default (10)
        const limit = limitArg === 0 ? 0 : (limitArg ?? 10);
        result = await handleReadMessages(
          args?.topic as string | undefined,
          limit,
          (args?.clear as boolean) ?? false
        );
        break;

      case "mqtt_list_subscriptions":
        result = await handleListSubscriptions();
        break;

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Main entry point
async function main() {
  console.error("Starting MQTT MCP Server...");
  console.error(`Broker URL: ${MQTT_BROKER_URL}`);
  console.error(`Client ID: ${MQTT_CLIENT_ID}`);
  console.error(`Username configured: ${MQTT_USERNAME ? 'yes' : 'no'}`);
  console.error(`Password configured: ${MQTT_PASSWORD ? 'yes' : 'no'}`);

  // Connect to MQTT broker on startup
  try {
    await ensureConnected();
  } catch (error) {
    console.error(`Warning: Initial MQTT connection failed. Will retry on first tool call.`);
  }

  // Start the MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("MQTT MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
