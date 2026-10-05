# Changelog

## 0.3.1 (unreleased source patch)

- Make Cost Doctor evidence actionable with verification steps, explicit data-quality gaps and unavailable-price handling. Unknown per-request fees remain null; no savings amount or quality equivalence is invented.

- Add optional schema-adapted analysis recipes through the existing metadata tool, with explicit unavailable capabilities and no automatic query execution.

- Add live-schema query preflight with actionable field/shape errors, explicit default date ranges, and metadata-aware aggregation explanations. Preserve empty-result and UTC bucket cautions; no private Analytics restoration is implied.

- Temporarily remove the unauthenticated private Analytics endpoint from both default MCP manifests to avoid the known 401 connection failure.
- Keep official OpenRouter capabilities and authenticated self-hosted Analytics source. Private account Analytics is not restored by this compatibility downgrade.
- Make skill and package descriptions accurately disclose capability availability.
- Add package regression tests that prevent private endpoint or credential headers from re-entering the default package.
- Retain the existing plugin identity, author, license, and prompt order; no plugin or server deployment is included.
- Sanitize unknown failures, discard upstream error payloads, bound requests, block redirects, and omit credentials from public metadata requests.
- Keep the private bridge fail-closed with constant-time bearer verification.
- Reject malformed financial responses and label partial query totals. Require confirmed complete data for account-wide optimization and anomaly conclusions.
- Use correct local day boundaries including DST-skipped midnight. Daily anomaly detection is explicitly limited to completed UTC days and consecutive baselines; gaps are not silently treated as zero.
- Add offline API, tool, authentication, financial-data, and timezone regression tests using synthetic fixtures only.

## 0.3.0

- Added account summary with today, yesterday, 7-day, and 30-day spend.
- Added live Analytics schema discovery.
- Added generic Usage Analytics queries.
- Added rolling-baseline cost anomaly detection.
- Added evidence-based Cost Doctor.
- Added read-only API-key metadata and usage.
- Added live model comparison and provider price evidence.
- Added OpenRouter workflow skill for ChatGPT and Codex.
- Added open-source documentation and Apache-2.0 licensing.
- Kept all RouterLens tools read-only.

