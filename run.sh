#!/bin/sh
# Start OctopusVidGen on this computer: http://127.0.0.1:8787 (it only listens on this machine).
cd "$(dirname "$0")/server" && exec ./target/release/octopus-server
