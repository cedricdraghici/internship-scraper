#!/usr/bin/env bash
#
# One-shot deploy: creates the Fly app, its volume, and its secrets, then ships it.
# Safe to re-run — every step checks whether it has already been done.
#
#   ./setup.sh                 # prompts for an app name
#   ./setup.sh my-job-tracker  # or pass one
#
set -euo pipefail

APP="${1:-}"

command -v fly >/dev/null 2>&1 || {
  echo "fly CLI not found. Install it first:"
  echo "  brew install flyctl        # macOS"
  echo "  curl -L https://fly.io/install.sh | sh   # Linux/WSL"
  exit 1
}

fly auth whoami >/dev/null 2>&1 || {
  echo "Not logged in to Fly. Run:  fly auth signup   (or: fly auth login)"
  exit 1
}

if [ -z "$APP" ]; then
  # Fly app names are global, so this cannot be defaulted to something generic.
  read -r -p "Choose a unique app name (e.g. yourname-job-tracker): " APP
fi
[ -n "$APP" ] || { echo "An app name is required."; exit 1; }

REGION="${FLY_REGION:-yyz}"   # yyz = Toronto; see `fly platform regions`

echo
echo "==> App:    $APP"
echo "==> Region: $REGION"
echo

# 1. The app itself.
if fly status --app "$APP" >/dev/null 2>&1; then
  echo "==> App already exists, reusing it."
else
  echo "==> Creating app..."
  fly apps create "$APP"
fi

# Point fly.toml at this app rather than whoever forked it.
if [ "$(uname)" = "Darwin" ]; then
  sed -i '' "s/^app = .*/app = '$APP'/" fly.toml
  sed -i '' "s/^primary_region = .*/primary_region = '$REGION'/" fly.toml
else
  sed -i "s/^app = .*/app = '$APP'/" fly.toml
  sed -i "s/^primary_region = .*/primary_region = '$REGION'/" fly.toml
fi

# 2. The volume. Without it, every redeploy wipes the database — and with it the
#    applied/interview marks, which are the only data that cannot be re-scraped.
if fly volumes list --app "$APP" 2>/dev/null | grep -q jobtracker_data; then
  echo "==> Volume already exists."
else
  echo "==> Creating 1GB volume..."
  fly volumes create jobtracker_data --size 1 --region "$REGION" --app "$APP" --yes
fi

# 3. Secrets. Generated here so they are never typed, pasted, or committed.
EXISTING_SECRETS="$(fly secrets list --app "$APP" 2>/dev/null || true)"

if grep -q JT_PASSWORD <<<"$EXISTING_SECRETS"; then
  echo "==> JT_PASSWORD already set (leaving it alone)."
  PASSWORD='(unchanged)'
else
  PASSWORD="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
  fly secrets set JT_PASSWORD="$PASSWORD" --app "$APP" --stage
fi

if grep -q JT_NTFY_TOPIC <<<"$EXISTING_SECRETS"; then
  echo "==> JT_NTFY_TOPIC already set (leaving it alone)."
  TOPIC='(unchanged)'
else
  # The topic name is the only thing protecting your alerts, so make it unguessable.
  TOPIC="jobtracker-$(node -e "console.log(require('crypto').randomBytes(9).toString('hex'))")"
  fly secrets set JT_NTFY_TOPIC="$TOPIC" --app "$APP" --stage
fi

echo
echo "==> Deploying..."
fly deploy --app "$APP"

cat <<EOF

────────────────────────────────────────────────────────────
  Done. https://$APP.fly.dev

  Sign in with ANY username and this password:

      $PASSWORD

  Phone alerts — install ntfy (App Store / Play Store),
  tap +, and subscribe to this topic:

      $TOPIC

  Save both now. Fly stores secrets one-way and cannot show
  them again; to replace them:

      fly secrets set JT_PASSWORD='...' --app $APP
      fly secrets set JT_NTFY_TOPIC='...' --app $APP
────────────────────────────────────────────────────────────
EOF
