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
#
# Prod renews in standalone mode with pre/post hooks that stop and start
# libertasian-nginx, so renewal itself works. Without this hook the renewed
# cert never reached nginx: the 2026-10-04..06 outage, and the 2026-11-16
# CertificateExpirySoon alert (cert4 issued 2026-11-04 sat unused).

set -euo pipefail

LINEAGE="${RENEWED_LINEAGE:-/etc/letsencrypt/live/libertasian.com}"
SSL_DIR="${LIBERTASIAN_SSL_DIR:-/opt/libertasian/infrastructure/nginx/ssl}"
CONTAINER="${LIBERTASIAN_NGINX_CONTAINER:-libertasian-nginx}"

mkdir -p "$SSL_DIR"

# Write to temp files and rename them, so nginx never reads a half-written file.
# Keep the files owned like the directory (the deploy user), so a non-root
# operator can still inspect them. nginx's master process reads them as root.
OWNER="$(stat -c '%u:%g' "$SSL_DIR")"
install -m 0644 "$LINEAGE/fullchain.pem" "$SSL_DIR/.fullchain.pem.new"
install -m 0640 "$LINEAGE/privkey.pem" "$SSL_DIR/.privkey.pem.new"
chown "$OWNER" "$SSL_DIR/.fullchain.pem.new" "$SSL_DIR/.privkey.pem.new"
# rename() replaces a symlink itself, never its target, so old links are safe.
mv -f "$SSL_DIR/.fullchain.pem.new" "$SSL_DIR/fullchain.pem"
mv -f "$SSL_DIR/.privkey.pem.new" "$SSL_DIR/privkey.pem"

docker exec "$CONTAINER" nginx -t
docker exec "$CONTAINER" nginx -s reload

echo "certbot-deploy-hook: installed $(openssl x509 -noout -enddate -in "$SSL_DIR/fullchain.pem") into $CONTAINER"
