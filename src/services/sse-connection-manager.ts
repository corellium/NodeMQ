/**
 * SSEConnectionManager - Manages Server-Sent Events connections for frontend clients.
 * 
 * Requirements: 2.1, 2.5, 2.6, 2.3, 2.4
 * 
 * Handles:
 * - Client connection management (add/remove)
 * - Message delivery to clients
 * - Heartbeat mechanism for connection health
 * - Subscription lifecycle with TopicManager integration
 */

import { ServerResponse } from 'http';
import { TopicManager } from './topic-manager.js';

/**
 * SSE event types used for broadcasting messages.
 */
export const SSE_EVENT_TYPES = {
  /** Sensor data event - contains raw sensor payload */
  SENSOR: 'sensor',
  /** Heartbeat event - connection keep-alive */
  HEARTBEAT: 'heartbeat',
} as const;

/**
 * Represents an SSE client connection.
 */
export interface SSEClient {
  clientId: string;
  response: ServerResponse;
  connectedAt: Date;
  subscriptions: Set<string>;
}

/**
 * SSEConnectionManager handles Server-Sent Events connections.
 */
export class SSEConnectionManager {
  private clients: Map<string, SSEClient> = new Map();
  private topicManager: TopicManager;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private deliveredMessages: Map<string, Set<string>> = new Map(); // clientId -> Set of messageIds

  constructor(topicManager: TopicManager) {
    this.topicManager = topicManager;
  }

  /**
   * Adds a new SSE client connection.
   * Sets up SSE headers and handles disconnect cleanup.
   * 
   * @param clientId - Unique client identifier
   * @param response - HTTP ServerResponse for SSE streaming
   */
  addClient(clientId: string, response: ServerResponse): void {
    // Set SSE headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const client: SSEClient = {
      clientId,
      response,
      connectedAt: new Date(),
      subscriptions: new Set(),
    };

    this.clients.set(clientId, client);
    this.deliveredMessages.set(clientId, new Set());

    // Handle client disconnect
    response.on('close', () => {
      this.removeClient(clientId);
    });
  }


  /**
   * Removes a client connection and cleans up all subscriptions.
   * 
   * @param clientId - Unique client identifier
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      // Clean up all subscriptions in TopicManager
      this.topicManager.unsubscribeAll(clientId);
      
      // End the response if still writable
      if (!client.response.writableEnded) {
        client.response.end();
      }
      
      // Remove from clients map
      this.clients.delete(clientId);
      this.deliveredMessages.delete(clientId);
    }
  }

  /**
   * Subscribes a client to a topic pattern.
   * 
   * @param clientId - Unique client identifier
   * @param topicPattern - Topic pattern to subscribe to
   * @returns true if subscription was successful, false if client not found
   */
  subscribe(clientId: string, topicPattern: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    client.subscriptions.add(topicPattern);
    this.topicManager.subscribe(clientId, topicPattern);
    return true;
  }

  /**
   * Unsubscribes a client from a topic pattern.
   * 
   * @param clientId - Unique client identifier
   * @param topicPattern - Topic pattern to unsubscribe from
   * @returns true if unsubscription was successful, false if client not found
   */
  unsubscribe(clientId: string, topicPattern: string): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    client.subscriptions.delete(topicPattern);
    this.topicManager.unsubscribe(clientId, topicPattern);
    return true;
  }

  /**
   * Sends an SSE event to a specific client.
   * 
   * @param clientId - Unique client identifier
   * @param event - Event name
   * @param data - Data to send (will be JSON stringified)
   * @returns true if message was sent, false if client not found or write failed
   */
  sendToClient(clientId: string, event: string, data: unknown): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.response.writableEnded) {
      return false;
    }

    try {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      client.response.write(message);
      return true;
    } catch {
      // Client may have disconnected
      this.removeClient(clientId);
      return false;
    }
  }

  /**
   * Sends an SSE event to a specific client with pre-serialized data.
   * Used by broadcast() to avoid redundant JSON.stringify calls.
   * 
   * @param clientId - Unique client identifier
   * @param event - Event name
   * @param serializedData - Pre-serialized JSON string
   * @returns true if message was sent, false if client not found or write failed
   */
  private sendToClientPreSerialized(clientId: string, event: string, serializedData: string): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.response.writableEnded) {
      return false;
    }

    try {
      const message = `event: ${event}\ndata: ${serializedData}\n\n`;
      client.response.write(message);
      return true;
    } catch {
      // Client may have disconnected
      this.removeClient(clientId);
      return false;
    }
  }


  /**
   * Broadcasts data to all clients subscribed to matching topics.
   * Sends SSE events with type 'sensor' containing the sensor data directly.
   * 
   * @param topic - Topic to broadcast to
   * @param data - Sensor data to broadcast (will be JSON stringified)
   * @param messageId - Optional message ID for tracking delivery
   * @returns Array of client IDs that received the message
   */
  broadcast(topic: string, data: unknown, messageId?: string): string[] {
    const matchingClientIds = this.topicManager.getMatchingSubscribers(topic);
    const deliveredTo: string[] = [];

    // Pre-serialize once instead of per-client to eliminate redundant JSON.stringify calls
    const serializedData = JSON.stringify(data);

    for (const clientId of matchingClientIds) {
      const success = this.sendToClientPreSerialized(clientId, SSE_EVENT_TYPES.SENSOR, serializedData);
      if (success) {
        deliveredTo.push(clientId);
        if (messageId) {
          this.deliveredMessages.get(clientId)?.add(messageId);
        }
      }
    }

    return deliveredTo;
  }

  /**
   * Starts the heartbeat mechanism to keep connections alive.
   * Sends SSE comment lines at regular intervals.
   * 
   * @param intervalMs - Heartbeat interval in milliseconds
   */
  startHeartbeat(intervalMs: number): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
  }

  /**
   * Stops the heartbeat mechanism.
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Sends a heartbeat comment to all connected clients.
   * SSE comments (lines starting with :) keep the connection alive.
   */
  private sendHeartbeat(): void {
    const timestamp = new Date().toISOString();
    for (const [clientId, client] of this.clients) {
      if (!client.response.writableEnded) {
        try {
          client.response.write(`: heartbeat ${timestamp}\n\n`);
        } catch {
          // Client may have disconnected
          this.removeClient(clientId);
        }
      }
    }
  }

  /**
   * Gets the number of connected clients.
   * 
   * @returns Number of active client connections
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Checks if a client is connected.
   * 
   * @param clientId - Unique client identifier
   * @returns true if client is connected
   */
  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  /**
   * Gets all connected client IDs.
   * 
   * @returns Array of connected client IDs
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Gets the subscriptions for a specific client.
   * 
   * @param clientId - Unique client identifier
   * @returns Array of topic patterns the client is subscribed to, or empty array if not found
   */
  getClientSubscriptions(clientId: string): string[] {
    const client = this.clients.get(clientId);
    return client ? Array.from(client.subscriptions) : [];
  }

  /**
   * Checks if a message was delivered to a client.
   * 
   * @param clientId - Unique client identifier
   * @param messageId - Message identifier
   * @returns true if message was delivered to the client
   */
  wasMessageDelivered(clientId: string, messageId: string): boolean {
    const delivered = this.deliveredMessages.get(clientId);
    return delivered ? delivered.has(messageId) : false;
  }

  /**
   * Gets the TopicManager instance.
   * 
   * @returns The TopicManager used by this SSEConnectionManager
   */
  getTopicManager(): TopicManager {
    return this.topicManager;
  }
}
