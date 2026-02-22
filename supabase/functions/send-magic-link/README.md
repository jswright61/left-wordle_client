# send-magic-link

Edge Function that generates a Supabase magic link and sends it through Postmark.

## Required secrets
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POSTMARK_SERVER_TOKEN`

## Optional secrets
- `MAGIC_LINK_SITE_URL` (default: `https://left-wordle.com`)
- `MAGIC_LINK_ALLOWED_PATHS` (comma-separated; default includes `/sync-resolve`)
- `POSTMARK_TEMPLATE_ALIAS` (default: `magic-link`)
- `POSTMARK_FROM_EMAIL` (default: `no-reply@left-wordle.com`)

## Deploy
```bash
supabase functions deploy send-magic-link
```

## Example invoke payload
```json
{
  "email": "player@example.com",
  "redirectPath": "/sync-resolve"
}
```
