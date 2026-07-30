#!/usr/bin/env bash

set -Eeuo pipefail

archive_path="${1:?archive path is required}"
release_id="${2:?release id is required}"
deploy_root="${DEPLOY_ROOT:-/var/www/ternary-dev}"

if [[ "$deploy_root" != "/var/www/ternary-dev" ]]; then
  echo "Unexpected deploy root: $deploy_root" >&2
  exit 1
fi

if [[ ! "$release_id" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release id must be a full Git commit SHA" >&2
  exit 1
fi

expected_archive="/tmp/ternary-${release_id}.tgz"
if [[ "$archive_path" != "$expected_archive" || ! -f "$archive_path" ]]; then
  echo "Deployment archive is missing or has an unexpected path" >&2
  exit 1
fi

release_dir="$deploy_root/releases/$release_id"
temporary_link="$deploy_root/current.$release_id"

mkdir -p "$release_dir"
tar -xzf "$archive_path" -C "$release_dir"

if [[ ! -f "$release_dir/index.html" || ! -d "$release_dir/assets" ]]; then
  echo "Release validation failed: index.html or assets directory is missing" >&2
  exit 1
fi

ln -sfn "$release_dir" "$temporary_link"
mv -Tf "$temporary_link" "$deploy_root/current"
rm -f "$archive_path"

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
