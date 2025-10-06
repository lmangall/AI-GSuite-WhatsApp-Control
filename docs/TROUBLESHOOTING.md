# LangChain Integration Troubleshooting Guide

## Common Issues and Solutions

### 1. Configuration Issues

#### Problem: "Configuration validation failed"
**Symptoms:**
- Application fails to start
- Error messages about missing configuration

**Solutions:**
1. Check that `.env` file exists and contains all required variables
2. Verify API keys are valid and not expired
3. Ensure numeric values are within valid ranges

```bash
# Check configuration
curl http://localhost:3000/health/langchain
```

#### Problem: "No AI models are available"
**Symptoms:**
- All message processing fails
- Health check shows models as unavailable

**Solutions:**
1. Verify API keys for Gemini and OpenAI
2. Check API quotas and rate limits
3. Test API connectivity manually

```bash
# Test Gemini API
curl -H "Authorization: Bearer $GEMINI_API_KEY" \
  https://generativelanguage.googleapis.com/v1/models

# Test OpenAI API
curl -H "Authorization: Bearer $OPENAI_API_KEY" \
  https://api.openai.com/v1/models
```

### 2. Tool Execution Issues

#### Problem: "MCP tools not available"
**Symptoms:**
- Tool discovery returns empty results
- MCP-related intents fail

**Solutions:**
1. Verify MCP server is running and accessible
2. Check MCP_SERVER_URL configuration
3. Test MCP server connectivity

```bash
# Test MCP server
curl http://localhost:3001/tools/list
```

#### Problem: "Brave Search tool failed"
**Symptoms:**
- Web search queries return errors
- Search intent detection works but execution fails

**Solutions:**
1. Verify BRAVE_SEARCH_API_KEY is valid
2. Check Brave API quotas
3. Test Brave API directly

```bash
# Test Brave Search API
curl -H "X-Subscription-Token: $BRAVE_SEARCH_API_KEY" \
  "https://api.search.brave.com/res/v1/web/search?q=test"
```

### 3. Memory Issues

#### Problem: "Memory operations failing"
**Symptoms:**
- Conversation context not maintained
- Memory-related errors in logs

**Solutions:**
1. Check memory configuration settings
2. Monitor memory usage metrics
3. Adjust token limits if needed

```typescript
// Check memory stats
const memoryStats = memoryManager.getMemoryStats();
console.log('Memory stats:', memoryStats);
```

#### Problem: "Token limit exceeded"
**Symptoms:**
- Responses are truncated
- Memory cleanup happens too frequently

**Solutions:**
1. Increase LANGCHAIN_MAX_TOKENS
2. Adjust LANGCHAIN_MEMORY_EXPIRY_HOURS
3. Monitor token usage patterns

### 4. Circuit Breaker Issues

#### Problem: "Circuit breaker is OPEN"
**Symptoms:**
- Requests fail with circuit breaker error
- System falls back to legacy agents

**Solutions:**
1. Check what caused the circuit to open
2. Fix underlying issues
3. Reset circuit breaker if needed

```typescript
// Check circuit breaker status
const status = agentFactory.getCircuitBreakerStatus();

// Reset circuit breakers
agentFactory.resetCircuitBreakers();
```

#### Problem: "Frequent circuit breaker trips"
**Symptoms:**
- Circuit breaker opens and closes frequently
- Inconsistent response quality

**Solutions:**
1. Investigate root cause of failures
2. Adjust circuit breaker thresholds
3. Improve error handling in components

### 5. Performance Issues

#### Problem: "Slow response times"
**Symptoms:**
- High average response times
- Timeout errors

**Solutions:**
1. Monitor component performance metrics
2. Adjust timeout values
3. Optimize tool execution

```typescript
// Check performance metrics
const metrics = await monitoringService.collectMetrics();
console.log('Average response time:', metrics.averageResponseTime);
```

#### Problem: "High memory usage"
**Symptoms:**
- Application memory usage grows over time
- Out of memory errors

**Solutions:**
1. Check memory cleanup configuration
2. Monitor memory statistics
3. Adjust cleanup intervals

### 6. Intent Detection Issues

#### Problem: "Wrong intent detected"
**Symptoms:**
- Messages routed to wrong handlers
- Unexpected tool usage

**Solutions:**
1. Review intent detection patterns
2. Adjust confidence thresholds
3. Add more specific keywords

```env
# Adjust confidence threshold
LANGCHAIN_INTENT_CONFIDENCE_THRESHOLD=0.8
```

#### Problem: "Intent detection always fails"
**Symptoms:**
- All messages default to general chat
- No tool usage despite relevant queries

**Solutions:**
1. Check intent detection service logs
2. Verify pattern configuration
3. Test with known intent patterns

### 7. Logging and Monitoring Issues

#### Problem: "No structured logs appearing"
**Symptoms:**
- Missing detailed log entries
- Monitoring data unavailable

**Solutions:**
1. Enable structured logging
2. Check log level configuration
3. Verify logging service initialization

```env
# Enable detailed logging
LANGCHAIN_ENABLE_TRACING=true
LANGCHAIN_ENABLE_METRICS=true
```

#### Problem: "Health checks failing"
**Symptoms:**
- Health endpoint returns errors
- Monitoring shows unhealthy status

**Solutions:**
1. Check individual component health
2. Review component dependencies
3. Verify service initialization order

## Diagnostic Commands

### Health Check
```bash
curl http://localhost:3000/health/langchain
```

### Component Status
```bash
# Check agent status
curl http://localhost:3000/agent/status

# Check tool status
curl http://localhost:3000/tools/status

# Check memory status
curl http://localhost:3000/memory/status
```

### Metrics Export
```bash
# Get Prometheus metrics
curl http://localhost:3000/metrics/prometheus

# Get dashboard data
curl http://localhost:3000/metrics/dashboard
```

## Log Analysis

### Key Log Events to Monitor

1. **Startup Events**
   - `startup_success` / `startup_failure`
   - Component initialization logs

2. **Agent Execution**
   - `agent_execution` events
   - Performance metrics
   - Error patterns

3. **Tool Usage**
   - `tool_execution` events
   - Success/failure rates
   - Execution times

4. **Circuit Breaker Events**
   - `circuit_breaker_event`
   - State changes
   - Failure patterns

5. **Memory Operations**
   - `memory_operation` events
   - Cleanup activities
   - Usage statistics

### Log Filtering Examples

```bash
# Filter agent execution logs
grep "agent_execution" application.log

# Filter error logs
grep "level.*error" application.log

# Filter circuit breaker events
grep "circuit_breaker" application.log
```

## Performance Monitoring

### Key Metrics to Track

1. **Response Times**
   - Average execution time
   - 95th percentile response time
   - Timeout frequency

2. **Success Rates**
   - Agent execution success rate
   - Tool execution success rate
   - Overall system success rate

3. **Resource Usage**
   - Memory usage per user
   - Token consumption
   - API call frequency

4. **Circuit Breaker Health**
   - Circuit state distribution
   - Failure rates
   - Recovery times

### Alerting Thresholds

```yaml
# Example alerting rules
alerts:
  - name: HighErrorRate
    condition: error_rate > 10%
    duration: 5m
    
  - name: SlowResponseTime
    condition: avg_response_time > 5000ms
    duration: 2m
    
  - name: CircuitBreakerOpen
    condition: circuit_breaker_state == "OPEN"
    duration: 1m
    
  - name: MemoryUsageHigh
    condition: memory_usage > 80%
    duration: 5m
```

## Emergency Procedures

### 1. Disable LangChain Integration
```env
USE_LANGCHAIN=false
```
This will immediately fall back to legacy agents.

### 2. Force Circuit Breakers Open
```typescript
agentFactory.forceCircuitBreakersOpen();
```
This will force fallback to legacy systems.

### 3. Clear All Memory
```typescript
// Clear all user memories
memoryManager.clearAllMemories();
```

### 4. Reset All Components
```bash
# Restart the application
npm run start:prod
```

## Getting Help

### Information to Collect

When reporting issues, include:

1. **Configuration**
   - Environment variables (sanitized)
   - Version information
   - Deployment environment

2. **Logs**
   - Recent error logs
   - Structured log entries
   - Performance metrics

3. **System State**
   - Health check results
   - Circuit breaker status
   - Component status

4. **Reproduction Steps**
   - Specific user inputs
   - Expected vs actual behavior
   - Frequency of occurrence

### Log Collection Script

```bash
#!/bin/bash
# collect-logs.sh

echo "Collecting LangChain integration diagnostics..."

# Health status
curl -s http://localhost:3000/health/langchain > health.json

# Recent logs
tail -n 1000 application.log | grep -E "(langchain|agent|tool|memory)" > langchain.log

# Metrics
curl -s http://localhost:3000/metrics/dashboard > metrics.json

# Configuration (sanitized)
env | grep -E "LANGCHAIN|USE_LANGCHAIN" | sed 's/=.*/=***/' > config.txt

echo "Diagnostics collected in current directory"
```

## Prevention

### Best Practices

1. **Monitoring**
   - Set up comprehensive monitoring
   - Configure appropriate alerts
   - Regular health checks

2. **Configuration Management**
   - Use configuration validation
   - Document all settings
   - Version control configurations

3. **Testing**
   - Test all components regularly
   - Validate API connectivity
   - Monitor performance trends

4. **Maintenance**
   - Regular log review
   - Proactive issue identification
   - Capacity planning

### Regular Maintenance Tasks

1. **Daily**
   - Check health status
   - Review error logs
   - Monitor performance metrics

2. **Weekly**
   - Analyze usage patterns
   - Review circuit breaker events
   - Check API quotas

3. **Monthly**
   - Performance trend analysis
   - Configuration review
   - Capacity planning

4. **Quarterly**
   - Full system health review
   - Update documentation
   - Disaster recovery testing