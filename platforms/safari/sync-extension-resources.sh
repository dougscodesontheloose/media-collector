#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
repo_root=${script_dir:h:h}
resources="$script_dir/Media Collector/Media Collector Extension/Resources"

shared_files=(
  LICENSE adapters.js background.js content.js core.js inline-source.js
  instagram-inline.css instagram-inline.js media-indicator.js mse-client.js
  mse-observer.js native-stream.js observed-media.js page-extraction.js panel.css
  panel.html panel.js processor.html processor.js profile.js reddit-inline.css
  reddit-inline.js streams.js traffic-bridge.js web-detector.js x-inline.css x-inline.js
)

for file in $shared_files; do
  rsync -a "$repo_root/$file" "$resources/$file"
done
rsync -a --delete "$repo_root/assets/" "$resources/assets/"
rsync -a --delete "$repo_root/vendor/" "$resources/vendor/"

echo "Recursos compartilhados sincronizados com a versão Safari."
