#!/bin/bash

# Ensure that a file is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <file_path>"
  exit 1
fi

# Get the full path of the file
file_path="$1"

# Define the project root directory
project_root="$DD_SOURCE_ROOT"

# Extract the directory of the file
file_dir=$(dirname "$file_path")

# Ensure the file directory is within the project root
if [[ "$file_dir" != $project_root* ]]; then
  echo "The file is not within the project root: $project_root"
  exit 1
fi

# Remove the project root from the file directory to get the Bazel target path
bazel_target="//${file_dir#"$project_root"/}/..."

# Output the Bazel target path
echo "$bazel_target"

