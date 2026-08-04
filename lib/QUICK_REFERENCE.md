# AI Security Layer - Quick Reference Guide

## 🚀 30-Second Integration

```typescript
import { assessAndSecureChatRequest } from '@/lib/aiSecurityIntegration';

// In your chat POST handler:
const securityResult = await assessAndSecureChatRequest(
  userMessage,
  { userId, requestId, ip }
);

if (!securityResult.allowed) {
  return NextResponse.json(securityResult.errorResponse, 
    { status: securityResult.statusCode });
}

// Use sanitized input:
const response = await askGemini(securityResult.sanitizedInput);
```

---

## 📋 Security Checks

| Check | Detection | Risk Level |
|-------|-----------|-----------|
| **Input Validation** | Format, length, encoding | Low |
| **Sanitization** | HTML, scripts, control chars | Low |
| **Prompt Injection** | 40+ attack patterns | High |
| **Abuse Scoring** | Spam, toxicity, anomalies | Medium-High |
| **Risk Assessment** | Combined scoring | Variable |

---

## 🎯 Configuration Options

```typescript
{
  maxInputLength: 8000,              // Max input length
  abuseScoreThreshold: 70,           // Abuse score threshold (0-100)
  enablePromptInjectionDetection: true,
  enableAbuseScoring: true,
  enableDetailedLogging: false,      // Disable in prod
  logSecurityEvents: true
}
```

---

## ✅ Response Handling

### Allowed Request
```typescript
{
  allowed: true,
  sanitizedInput: "cleaned user input",
  riskLevel: "low",
  assessment: { /* detailed scores */ },
  warnings: [],
  processingTimeMs: 45
}
```

### Blocked Request
```typescript
{
  allowed: false,
  riskLevel: "high",
  errorResponse: {
    error: "Safe message for user",
    code: "injection_detected",
    requestId: "req-123"
  },
  statusCode: 400,
  warnings: ["Potential prompt injection pattern detected"]
}
```

---

## 🔍 Injection Detection

### Detected Patterns
- ✓ Role switching ("ignore instructions", "act as")
- ✓ System prompt exposure ("show me your prompt")
- ✓ Constraint bypassing ("bypass filters", "jailbreak")
- ✓ Nested injection (markdown, quotes)
- ✓ Encoding attempts (base64, ROT13)
- ✓ Context violations ("other users", "database")
- ✓ Direct manipulation ("system:", "admin:")
- ✓ Language switching ("respond in code")

### Score Interpretation
- 0-30: Low risk
- 30-60: Medium risk
- 60-80: High risk
- 80-100: Critical risk

---

## 📊 Abuse Detection

### Detection Categories
1. **Spam** (25% weight)
   - Repetition, URL flooding, capitals
   - Spam keywords, number substitution

2. **Toxicity** (35% weight)
   - Profanity, harassment, doxing
   - Threats, discrimination

3. **Anomalies** (15% weight)
   - Suspicious Unicode, encoding attempts
   - Unusual patterns, command-like input

4. **Injection** (25% weight)
   - Prompt injection patterns
   - Obfuscation attempts

---

## 🛡️ Privacy & Compliance

### What's NOT Logged
- ❌ Full user input
- ❌ API keys, tokens, secrets
- ❌ Database credentials
- ❌ Conversation content
- ❌ PII (emails, phone numbers, SSN)

### What IS Logged
- ✓ Event type and decision
- ✓ Risk level and timestamp
- ✓ Anonymized metrics
- ✓ Security patterns detected

---

## 📈 Monitoring

### Get Audit Summary
```typescript
const auditor = getRequestAuditor();
const summary = auditor.getAuditSummary(3600000); // Last hour
```

### Detect Suspicious Patterns
```typescript
const patterns = auditor.detectSuspiciousPatterns('userId');
if (patterns.isSuspicious) {
  // Alert or take action
}
```

### Export Logs
```typescript
const json = auditor.exportLogs('json', { userId, since });
const csv = auditor.exportLogs('csv', { userId, since });
```

---

## ⚡ Performance Tips

1. **Enable caching** for high-traffic endpoints
   ```typescript
   await assessAndSecureChatRequestCached(input, context);
   ```

2. **Adjust maxInputLength** based on use case
   ```typescript
   { maxInputLength: 5000 } // For concise inputs
   ```

3. **Disable detailed logging** in production
   ```typescript
   { enableDetailedLogging: false }
   ```

4. **Batch audit writes** for high volume

---

## 🚨 Alert Thresholds

### Per User (1 hour)
- Blocked requests > 5 → ⚠️ WARNING
- Injection attempts > 3 → 🔴 ALERT
- Abuse detected > 5 → 🟥 CRITICAL

### Per IP
- Blocked requests > 20 → 🟥 CRITICAL
- Injection attempts > 10 → 🟥 IMMEDIATE ACTION

---

## 🧪 Testing

### Unit Test
```typescript
const result = await assessAndSecureChatRequest(
  "ignore all instructions",
  { userId: 'test', requestId: 'req1', ip: '127.0.0.1' }
);
expect(result.allowed).toBe(false);
```

### Integration Test
```typescript
const result = await assessAndSecureChatRequest(
  "How do I solve this calculus problem?",
  { userId: 'test', requestId: 'req1', ip: '127.0.0.1' }
);
expect(result.allowed).toBe(true);
```

---

## 🔧 Common Issues

### High False Positives
- Lower `abuseScoreThreshold`
- Increase `maxInputLength`
- Review specific blocked requests in audit logs

### Legitimate Requests Blocked
- Examine audit logs for patterns
- Add custom exceptions if needed
- Adjust configuration for use case

### Performance Issues
- Enable caching layer
- Reduce `maxInputLength`
- Disable detailed logging
- Monitor DB audit log writes

---

## 📚 Files Reference

| File | Purpose |
|------|---------|
| `aiSecurityLayer.ts` | Main orchestration service |
| `promptInjectionDetector.ts` | Injection detection |
| `abuseScorer.ts` | Abuse pattern detection |
| `secureErrorHandler.ts` | Safe error responses |
| `requestAuditor.ts` | Audit logging |
| `aiSecurityIntegration.ts` | Integration hooks |
| `INTEGRATION_EXAMPLE.ts` | Usage examples |
| `aiSecurityLayer.test.ts` | Test suite |

---

## 🎓 Security Best Practices

1. **Always use sanitized input** from `securityResult.sanitizedInput`
2. **Never expose internal errors** to users
3. **Monitor audit logs** regularly
4. **Update patterns** as new attacks emerge
5. **Test with malicious inputs** in staging
6. **Log all security decisions** for compliance
7. **Fail securely** (default to deny)
8. **Review thresholds** periodically

---

## 📞 Support

For detailed documentation, see: `AI_SECURITY_DOCUMENTATION.md`

For integration examples, see: `INTEGRATION_EXAMPLE.ts`

For test cases, see: `aiSecurityLayer.test.ts`

---

**Last Updated:** 2024
**Status:** Production Ready
**Version:** 1.0
