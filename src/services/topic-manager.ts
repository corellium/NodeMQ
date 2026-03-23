/**
 * TopicManager - Manages MQTT-style hierarchical topics with wildcard support.
 * 
 * Requirements: 8.1, 2.2, 2.3, 2.7, 8.2, 8.3
 * 
 * Topic format: sensors/{modelId}/{sensorType}/{sensorId}
 * 
 * Wildcard support:
 * - `+` matches exactly one level: sensors/+/temperature/+
 * - `#` matches zero or more levels: sensors/model1/#
 */

/**
 * Represents a topic subscription for a client.
 */
export interface TopicSubscription {
  clientId: string;
  pattern: string;
  isWildcard: boolean;
}

/**
 * TopicManager handles topic subscriptions and matching.
 */
export class TopicManager {
  private subscriptions: Map<string, Set<string>> = new Map(); // clientId -> Set of patterns
  private patternToClients: Map<string, Set<string>> = new Map(); // pattern -> Set of clientIds
  
  // Cache split patterns to avoid repeated string splits on every match
  private splitPatternCache: Map<string, string[]> = new Map();

  /**
   * Builds a topic string from sensor data components.
   * Format: sensors/{modelId}/{deviceBus}/{sensorType}/{sensorId}
   * If deviceBus is not provided, uses 'default' as the bus name.
   * 
   * @param modelId - Source model identifier
   * @param sensorType - Type of sensor (already resolved, e.g. 'SPI-PSTAT')
   * @param sensorId - Sensor identifier
   * @param deviceBus - Optional device bus identifier (e.g., 'spi0', 'i2c1', 'can0')
   * @returns Hierarchical topic string
   */
  buildTopic(modelId: string, sensorType: string, sensorId: string, deviceBus?: string): string {
    const bus = deviceBus ?? 'default';
    return `sensors/${modelId}/${bus}/${sensorType}/${sensorId}`;
  }

  /**
   * Subscribes a client to a topic pattern.
   * 
   * @param clientId - Unique client identifier
   * @param topicPattern - Topic pattern (may include wildcards)
   */
  subscribe(clientId: string, topicPattern: string): void {
    // Add to client's subscriptions
    if (!this.subscriptions.has(clientId)) {
      this.subscriptions.set(clientId, new Set());
    }
    this.subscriptions.get(clientId)!.add(topicPattern);

    // Add to pattern's clients
    if (!this.patternToClients.has(topicPattern)) {
      this.patternToClients.set(topicPattern, new Set());
    }
    this.patternToClients.get(topicPattern)!.add(clientId);
    
    // Pre-split and cache the pattern to avoid repeated splits during matching
    if (!this.splitPatternCache.has(topicPattern)) {
      this.splitPatternCache.set(topicPattern, topicPattern.split('/'));
    }
  }

  /**
   * Unsubscribes a client from a topic pattern.
   * 
   * @param clientId - Unique client identifier
   * @param topicPattern - Topic pattern to unsubscribe from
   */
  unsubscribe(clientId: string, topicPattern: string): void {
    // Remove from client's subscriptions
    const clientSubs = this.subscriptions.get(clientId);
    if (clientSubs) {
      clientSubs.delete(topicPattern);
      if (clientSubs.size === 0) {
        this.subscriptions.delete(clientId);
      }
    }

    // Remove from pattern's clients
    const patternClients = this.patternToClients.get(topicPattern);
    if (patternClients) {
      patternClients.delete(clientId);
      if (patternClients.size === 0) {
        this.patternToClients.delete(topicPattern);
        // Clean up cached split pattern when no clients remain
        this.splitPatternCache.delete(topicPattern);
      }
    }
  }

  /**
   * Unsubscribes a client from all topic patterns.
   * 
   * @param clientId - Unique client identifier
   */
  unsubscribeAll(clientId: string): void {
    const clientSubs = this.subscriptions.get(clientId);
    if (clientSubs) {
      // Remove client from all pattern mappings
      for (const pattern of clientSubs) {
        const patternClients = this.patternToClients.get(pattern);
        if (patternClients) {
          patternClients.delete(clientId);
          if (patternClients.size === 0) {
            this.patternToClients.delete(pattern);
          }
        }
      }
      // Remove client's subscription set
      this.subscriptions.delete(clientId);
    }
  }

  /**
   * Gets all client IDs subscribed to patterns matching the given topic.
   * 
   * @param topic - Concrete topic string (no wildcards)
   * @returns Array of client IDs whose subscriptions match the topic
   */
  getMatchingSubscribers(topic: string): string[] {
    const matchingClients = new Set<string>();

    for (const [pattern, clients] of this.patternToClients) {
      if (this.matchTopic(pattern, topic)) {
        for (const clientId of clients) {
          matchingClients.add(clientId);
        }
      }
    }

    return Array.from(matchingClients);
  }

  /**
   * Checks if a topic pattern matches a concrete topic.
   * 
   * Wildcard rules:
   * - `+` (single-level) matches exactly one topic level
   * - `#` (multi-level) matches zero or more levels, must be last segment
   * 
   * @param pattern - Topic pattern (may include wildcards)
   * @param topic - Concrete topic string
   * @returns true if the pattern matches the topic
   */
  matchTopic(pattern: string, topic: string): boolean {
    // Use cached split pattern if available, otherwise split and cache it
    let patternParts = this.splitPatternCache.get(pattern);
    if (!patternParts) {
      patternParts = pattern.split('/');
      this.splitPatternCache.set(pattern, patternParts);
    }
    
    const topicParts = topic.split('/');

    let patternIdx = 0;
    let topicIdx = 0;

    while (patternIdx < patternParts.length) {
      const patternPart = patternParts[patternIdx];

      // Multi-level wildcard (#) matches zero or more remaining levels
      if (patternPart === '#') {
        // # must be the last segment in the pattern
        return patternIdx === patternParts.length - 1;
      }

      // If we've run out of topic parts but still have pattern parts
      if (topicIdx >= topicParts.length) {
        return false;
      }

      const topicPart = topicParts[topicIdx];

      // Single-level wildcard (+) matches exactly one level
      if (patternPart === '+') {
        // + matches any single level, continue
        patternIdx++;
        topicIdx++;
        continue;
      }

      // Exact match required
      if (patternPart !== topicPart) {
        return false;
      }

      patternIdx++;
      topicIdx++;
    }

    // Pattern exhausted - topic must also be exhausted for a match
    return topicIdx === topicParts.length;
  }

  /**
   * Checks if a pattern contains wildcards.
   * 
   * @param pattern - Topic pattern to check
   * @returns true if the pattern contains + or # wildcards
   */
  isWildcardPattern(pattern: string): boolean {
    return pattern.includes('+') || pattern.includes('#');
  }

  /**
   * Gets all subscriptions for a client.
   * 
   * @param clientId - Unique client identifier
   * @returns Array of topic patterns the client is subscribed to
   */
  getClientSubscriptions(clientId: string): string[] {
    const subs = this.subscriptions.get(clientId);
    return subs ? Array.from(subs) : [];
  }

  /**
   * Checks if a client has any subscriptions.
   * 
   * @param clientId - Unique client identifier
   * @returns true if the client has at least one subscription
   */
  hasSubscriptions(clientId: string): boolean {
    const subs = this.subscriptions.get(clientId);
    return subs !== undefined && subs.size > 0;
  }

  /**
   * Gets the total number of unique subscribers.
   * 
   * @returns Number of clients with at least one subscription
   */
  getSubscriberCount(): number {
    return this.subscriptions.size;
  }
}
