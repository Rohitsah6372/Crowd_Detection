@echo off
REM Install Python dependencies
pip install -r requirements.txt
pip install -r YOLO-CROWD\requirements.txt

REM Download YOLO-CROWD model (v1.0)
if not exist models mkdir models
curl -L -o models\yolo-crowd.pt https://github.com/AmirkhanAliev/YOLO-Crowd/releases/download/v1.0/yolo-crowd.pt

echo Setup complete!
pause 