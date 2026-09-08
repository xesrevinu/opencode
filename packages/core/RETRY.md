# Retry Configuration

Main model stream requests retry on transient provider failures (rate limits, internal errors, transport failures) before output starts. Once any output is emitted, failures become durable to avoid duplicate or discarded partial responses.

## Default Behavior

- **4 retries** (5 attempts total)
- **Exponential backoff**: 2s, 4s, 8s, 16s
- **Total retry window**: ~30 seconds

This default assumes stable networks (e.g., North America/Europe to OpenAI/Anthropic US endpoints).

## Environment Overrides

For unstable network environments (e.g., China to overseas providers), extend the retry budget:

```sh
# Attempt up to 10 times (9 retries)
export OPENCODE_RETRY_ATTEMPTS=9

# Cap per-attempt delay at 30 seconds (prevents exponential from reaching minutes)
export OPENCODE_RETRY_MAX_DELAY_MS=30000
```

With these settings: 2s, 4s, 8s, 16s, 30s, 30s, 30s, 30s, 30s → ~3 minute window.

### Tuning Guidance

Measure your environment's degradation windows (time from failure to recovery):

```sql
-- Median recovery time for your setup
WITH failures AS (
  SELECT json_extract(data,'$.time.created') t,
         json_extract(data,'$.model.id') m
  FROM session_message
  WHERE type='assistant'
    AND json_extract(data,'$.error.type') IN ('provider.internal','provider.unknown')
),
next_success AS (
  SELECT f.t ft, (
    SELECT MIN(s.t)
    FROM (SELECT json_extract(data,'$.time.created') t, json_extract(data,'$.model.id') m
          FROM session_message WHERE type='assistant' AND json_extract(data,'$.error.type') IS NULL) s
    WHERE s.m = f.m AND s.t > f.t
  ) nt
  FROM failures f
)
SELECT
  COUNT(*) samples,
  ROUND(AVG((nt-ft)/1000.0), 1) avg_recovery_s,
  ROUND(MAX((nt-ft)/1000.0), 1) max_recovery_s
FROM next_success
WHERE nt IS NOT NULL;
```

Set `OPENCODE_RETRY_ATTEMPTS` and `OPENCODE_RETRY_MAX_DELAY_MS` to cover ~90th percentile recovery time:

| Avg Recovery | Recommended Config |
|---|---|
| < 30s | default (no override) |
| 1–3 min | `ATTEMPTS=9 MAX_DELAY=30000` |
| 3–10 min | `ATTEMPTS=15 MAX_DELAY=45000` |
| > 10 min | increase attempts; consider proxies/VPN |

**Limits:** `ATTEMPTS` capped at 20, `MAX_DELAY` at 300,000ms (5 min). Beyond that, provider degradation likely warrants changing network routes rather than extending client-side retries.

## Mid-Stream Failures

Once output starts streaming, transport failures are durable and do not retry. Retrying would either duplicate already-published output or require discarding partial work.

Observed frequency: ~8 failures (0.3% of 2700 assistant calls) lost partial output due to mid-stream drops. Prefix reuse is not implemented — the complexity cost outweighs the 0.3% hit.

If mid-stream failures spike in your environment, check network MTU/keepalive settings or use a local caching proxy.
