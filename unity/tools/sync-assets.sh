#!/bin/sh
# Разложить в Unity-проект модели и музыку из public/ (в git у Unity лежат только их .meta).
set -e
cd "$(dirname "$0")/../.."
M=unity/Assets/Models
mkdir -p $M/chars $M/monsters $M/gen $M/weapons $M/dungeon $M/Nature unity/Assets/Resources/Music
cp public/models/Slime.glb $M/
for d in chars monsters gen weapons dungeon; do cp public/models/$d/* $M/$d/; done
cp public/models/nature/* $M/Nature/
cp public/music/*.mp3 unity/Assets/Resources/Music/
echo "модели и музыка разложены"
