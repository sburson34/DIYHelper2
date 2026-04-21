# Backend contract: `POST /api/delete-user-data`

The privacy policy commits to deleting server-side user data within 30 days of a verified request. The app already calls this endpoint from `Settings → Delete My Data`; the backend needs to implement it.

## Request

```
POST /api/delete-user-data
Content-Type: application/json
X-Correlation-ID: <uuid>
X-App-Version: diyhelper2@1.0.0+2 (abc1234)

{
  "name":  "optional string",
  "email": "optional string",
  "phone": "optional string"
}
```

At least one of `email` or `phone` will be present — the app refuses to call this endpoint without contact info (there would be no identifier to match on).

## Response

Success (request received, verification email queued):
```json
{ "status": "queued", "requestId": "uuid" }
```
Status: `200 OK`.

Rejection (malformed input, no contact info):
```json
{ "error": "email or phone required" }
```
Status: `400 Bad Request`.

Any other failure is treated by the client as "endpoint unreachable" — the app falls back to a pre-filled `mailto:` link so the user can still submit the request manually. Don't rely on specific 5xx codes.

## Expected backend behavior

1. **Verification.** Anyone can type any email into the app — treat the incoming request as unauthenticated. Email the supplied `email` a one-time confirmation link (or call the supplied `phone` if you support SMS). Only perform deletion after the user clicks through.
2. **Deletion scope.** Delete every row, file, log, and backup entry keyed by the verified email or phone. At minimum:
   - `help_requests` rows where `customer_email` or `customer_phone` matches.
   - Any stored `photos/`, `videos/`, or `audio/` objects referenced by those rows.
   - `community_projects` rows submitted by that user (if the `submitCommunityProject` flow stores an author identifier).
   - Cached analyze requests keyed by that user's correlation IDs, if you persist those.
3. **Backup propagation.** Backups contain older copies — either purge them on the same cadence or rotate them out within the 30-day SLA.
4. **Audit.** Log the deletion event (timestamp, `requestId`, email hash) in a retention-exempt audit log so the completion can be proven if challenged.

## Rate limiting / abuse

- Accept at most N requests per email per day (suggest N=3). More than that → silently accept and drop.
- Accept at most M requests per IP per day (suggest M=20) to prevent someone harvesting a list of valid emails via "delete this" probes.

## Privacy policy alignment

- SLA: **30 days from verification** (not from submission). Matches the policy.
- The verification step itself isn't disclosed in the policy — that's expected; it's industry standard and not something you need to call out.
