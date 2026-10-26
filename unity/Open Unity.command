#!/bin/sh
# Открыть Unity-проект (двойной щелчок по .unity в Finder запускает редактор без проекта).
cd "$(dirname "$0")"
open -a "/Applications/Unity/Hub/Editor/6000.3.27f1/Unity.app" --args -projectPath "$(pwd)"
