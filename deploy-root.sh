#!/bin/bash
# À lancer avec sudo sur le VPS. N'affecte que le site solitaireabille.
set -e
DOMAIN=solitaireabille.duckdns.org
SRC=/home/guiggzz/solitaire-pwa
DST=/var/www/solitaire
mkdir -p $DST
rsync -a --delete --exclude deploy-root.sh $SRC/ $DST/
chown -R guiggzz:www-data $DST; chmod -R g+rX $DST
if [ ! -f /etc/nginx/sites-available/solitaire ]; then
cat > /etc/nginx/sites-available/solitaire <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $DST;
    index index.html;
    location = /sw.js { add_header Cache-Control "no-cache"; }
    location = /index.html { add_header Cache-Control "no-cache"; }
    location = /manifest.webmanifest { default_type application/manifest+json; add_header Cache-Control "no-cache"; }
    location / { try_files \$uri \$uri/ /index.html; }
}
NGX
ln -sf /etc/nginx/sites-available/solitaire /etc/nginx/sites-enabled/solitaire
nginx -t && systemctl reload nginx
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --redirect --register-unsafely-without-email || certbot --nginx -d $DOMAIN --redirect
fi
nginx -t && systemctl reload nginx
echo "OK -> https://$DOMAIN"
