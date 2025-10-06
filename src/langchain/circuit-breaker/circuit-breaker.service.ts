import { Injectable, Logger } from '@nestjs/common';

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeout: number;
  monitoringPeriod: number;
  halfOpenMaxCalls: number;
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  totalCalls: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  nextAttemptTime?: Date;
}

@Injectable()
export class LangChainCircuitBreakerService {
  private readonly logger = new Logger(LangChainCircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitBreakerInstance>();

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    circuitName: string,
    operation: () => Promise<T>,
    config?: Partial<CircuitBreakerConfig>
  ): Promise<T> {
    const circuit = this.getOrCreateCircuit(circuitName, config);
    return await circuit.execute(operation);
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(circuitName: string): CircuitBreakerStats | null {
    const circuit = this.circuits.get(circuitName);
    return circuit ? circuit.getStats() : null;
  }

  /**
   * Get all circuit breaker statistics
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, circuit] of this.circuits.entries()) {
      stats[name] = circuit.getStats();
    }
    return stats;
  }

  /**
   * Reset circuit breaker to closed state
   */
  reset(circuitName: string): void {
    const circuit = this.circuits.get(circuitName);
    if (circuit) {
      circuit.reset();
      this.logger.log(`Circuit breaker '${circuitName}' has been reset`);
    }
  }

  /**
   * Force circuit breaker to open state
   */
  forceOpen(circuitName: string): void {
    const circuit = this.circuits.get(circuitName);
    if (circuit) {
      circuit.forceOpen();
      this.logger.warn(`Circuit breaker '${circuitName}' has been forced open`);
    }
  }

  /**
   * Get or create circuit breaker instance
   */
  private getOrCreateCircuit(circuitName: string, config?: Partial<CircuitBreakerConfig>): CircuitBreakerInstance {
    if (!this.circuits.has(circuitName)) {
      const defaultConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        recoveryTimeout: 60000, // 1 minute
        monitoringPeriod: 10000, // 10 seconds
        halfOpenMaxCalls: 3
      };

      const finalConfig = { ...defaultConfig, ...config };
      const circuit = new CircuitBreakerInstance(circuitName, finalConfig, this.logger);
      this.circuits.set(circuitName, circuit);
    }

    return this.circuits.get(circuitName)!;
  }
}

class CircuitBreakerInstance {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private totalCalls = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttemptTime?: Date;
  private halfOpenCalls = 0;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig,
    private readonly logger: Logger
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.totalCalls++;

    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitBreakerState.HALF_OPEN;
        this.halfOpenCalls = 0;
        this.logger.debug(`Circuit breaker '${this.name}' moved to HALF_OPEN state`);
      } else {
        throw new Error(`Circuit breaker '${this.name}' is OPEN. Next attempt at ${this.nextAttemptTime?.toISOString()}`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalCalls: this.totalCalls,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenCalls = 0;
    this.nextAttemptTime = undefined;
  }

  forceOpen(): void {
    this.state = CircuitBreakerState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeout);
  }

  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = new Date();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      this.halfOpenCalls++;
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        this.state = CircuitBreakerState.CLOSED;
        this.failureCount = 0;
        this.logger.log(`Circuit breaker '${this.name}' moved to CLOSED state after successful recovery`);
      }
    } else if (this.state === CircuitBreakerState.CLOSED) {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Failure in half-open state immediately opens the circuit
      this.state = CircuitBreakerState.OPEN;
      this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeout);
      this.logger.warn(`Circuit breaker '${this.name}' moved to OPEN state after failure in HALF_OPEN`);
    } else if (this.state === CircuitBreakerState.CLOSED && this.failureCount >= this.config.failureThreshold) {
      // Too many failures in closed state opens the circuit
      this.state = CircuitBreakerState.OPEN;
      this.nextAttemptTime = new Date(Date.now() + this.config.recoveryTimeout);
      this.logger.warn(`Circuit breaker '${this.name}' moved to OPEN state after ${this.failureCount} failures`);
    }
  }

  private shouldAttemptReset(): boolean {
    return this.nextAttemptTime ? Date.now() >= this.nextAttemptTime.getTime() : false;
  }
}

// Specific circuit breaker configurations for different LangChain operations
export const LANGCHAIN_CIRCUIT_CONFIGS = {
  MODEL_EXECUTION: {
    failureThreshold: 3,
    recoveryTimeout: 30000, // 30 seconds
    monitoringPeriod: 5000,
    halfOpenMaxCalls: 2
  },
  TOOL_EXECUTION: {
    failureThreshold: 5,
    recoveryTimeout: 60000, // 1 minute
    monitoringPeriod: 10000,
    halfOpenMaxCalls: 3
  },
  MEMORY_OPERATIONS: {
    failureThreshold: 10,
    recoveryTimeout: 15000, // 15 seconds
    monitoringPeriod: 5000,
    halfOpenMaxCalls: 5
  },
  AGENT_EXECUTION: {
    failureThreshold: 3,
    recoveryTimeout: 45000, // 45 seconds
    monitoringPeriod: 10000,
    halfOpenMaxCalls: 2
  }
};