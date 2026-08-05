#!/usr/bin/env bash

set -Eeuo pipefail

archive_path="${1:?archive path is required}"
release_id="${2:?release id is required}"
deploy_root="${DEPLOY_ROOT:-/data/wwwroot/ternary.changyanedu.cn}"
domain="ternary.changyanedu.cn"
nginx_bin="/usr/local/nginx/sbin/nginx"
nginx_config="/usr/local/nginx/conf/nginx.conf"

if [[ "$deploy_root" != "/data/wwwroot/ternary.changyanedu.cn" ]]; then
  echo "Unexpected deploy root: $deploy_root" >&2
  exit 1
fi

if [[ ! "$release_id" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release id must be a full Git commit SHA" >&2
  exit 1
fi

expected_archive="/tmp/ternary-prod-${release_id}.tgz"
if [[ "$archive_path" != "$expected_archive" || ! -f "$archive_path" ]]; then
  echo "Deployment archive is missing or has an unexpected path" >&2
  exit 1
fi

if [[ ! -x "$nginx_bin" || ! -s "$nginx_config" ]]; then
  echo "Production Nginx installation is unavailable" >&2
  exit 1
fi

release_dir="$deploy_root/releases/$release_id"
temporary_link="$deploy_root/current.$release_id"

install -d -m 755 "$deploy_root/releases" "$release_dir"
tar -xzf "$archive_path" -C "$release_dir"

if [[ ! -s "$release_dir/index.html" \
  || ! -s "$release_dir/release.json" \
  || ! -s "$release_dir/REVISION" \
  || ! -d "$release_dir/assets" ]]; then
  echo "Release validation failed: required files are missing" >&2
  exit 1
fi

if ! find "$release_dir/assets" -maxdepth 1 -type f -name '*.js' -size +100k | grep -q . \
  || ! find "$release_dir/assets" -maxdepth 1 -type f -name '*.css' -size +1k | grep -q .; then
  echo "Release validation failed: JavaScript or CSS bundle is missing" >&2
  exit 1
fi

if [[ "$(cat "$release_dir/REVISION")" != "$release_id" ]] \
  || ! grep -Fq "\"commit\":\"$release_id\"" "$release_dir/release.json"; then
  echo "Release metadata does not match the requested commit" >&2
  exit 1
fi

chown -R www:www "$release_dir"
"$nginx_bin" -t -c "$nginx_config"

ln -sfn "$release_dir" "$temporary_link"
mv -Tf "$temporary_link" "$deploy_root/current"
if [[ "$(readlink "$deploy_root/current")" != "$release_dir" ]]; then
  echo "Release activation failed" >&2
  exit 1
fi

curl --fail --silent --show-error \
  --retry 5 --retry-delay 1 \
  --resolve "$domain:443:127.0.0.1" \
  "https://$domain/release.json" \
  | grep --fixed-strings "\"commit\":\"$release_id\"" > /dev/null

rm -f "$archive_path" /tmp/deploy-production.sh

mapfile -t old_releases < <(
  find "$deploy_root/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -nr \
    | tail -n +6 \
    | cut -d' ' -f2-
)

for old_release in "${old_releases[@]}"; do
  if [[ "$old_release" != "$deploy_root/releases/"* ]]; then
    echo "Refusing to remove unexpected path: $old_release" >&2
    exit 1
  fi
  rm -rf -- "$old_release"
done

echo "Deployed $release_id to $deploy_root/current"
