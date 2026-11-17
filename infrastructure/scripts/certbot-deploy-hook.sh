#!/usr/bin/env bash
# Certbot deploy hook: publish a renewed certificate to the nginx container.
#
# nginx runs in Docker and only sees ./infrastructure/nginx/ssl (bind mount),
# not /etc/letsencrypt, so symlinks into /etc/letsencrypt do not resolve inside
# the container. Copy the real files over instead, then reload nginx.
#
# Install on the host (once):
#   sudo install -m 0755 infrastructure/scripts/certbot-deploy-hook.sh \
#     /etc/letsencrypt/renewal-hooks/deploy/libertasian-nginx.sh
# Certbot runs every script in renewal-hooks/deploy/ after each successful
# renewal, with RENEWED_LINEAGE set to /etc/letsencrypt/live/<cert-name>.

set -euo pipefail

LINEAGE="${RENEWED_LINEAGE:-/etc/letsencrypt/live/libertasian.com}"
SSL_DIR="${LIBERTASIAN_SSL_DIR:-/opt/libertasian/infrastructure/nginx/ssl}"
CONTAINER="${LIBERTASIAN_NGINX_CONTAINER:-libertasian-nginx}"

mkdir -p "$SSL_DIR"

# Write to temp files and rename them, so nginx never reads a half-written file.
# Remove any old symlinks first so the rename replaces the link, not its target.
install -m 0644 "$LINEAGE/fullchain.pem" "$SSL_DIR/.fullchain.pem.new"
install -m 0600 "$LINEAGE/privkey.pem" "$SSL_DIR/.privkey.pem.new"
rm -f "$SSL_DIR/fullchain.pem" "$SSL_DIR/privkey.pem"
mv -f "$SSL_DIR/.fullchain.pem.new" "$SSL_DIR/fullchain.pem"
mv -f "$SSL_DIR/.privkey.pem.new" "$SSL_DIR/privkey.pem"

# nginx master runs as root in the container, so a 0600 root-owned key is readable.
docker exec "$CONTAINER" nginx -t
docker exec "$CONTAINER" nginx -s reload

echo "certbot-deploy-hook: installed $(openssl x509 -noout -enddate -in "$SSL_DIR/fullchain.pem") into $CONTAINER"
