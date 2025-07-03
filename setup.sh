#!/bin/bash
# Install Python dependencies
pip install -r requirements.txt
pip install -r YOLO-CROWD/requirements.txt

# Download YOLO-CROWD model (v1.0)
wget -O models/yolo-crowd.pt https://github.com/AmirkhanAliev/YOLO-Crowd/releases/download/v1.0/yolo-crowd.pt

echo "Setup complete!" 