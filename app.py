# app.py
from flask import Flask, render_template, Response, request, jsonify, send_from_directory
import cv2
import time
import os
from werkzeug.utils import secure_filename  # For secure handling of uploaded filenames
import threading

# Import the new CrowdProcessor module
from crowd_processor import CrowdProcessor

app = Flask(__name__)

# --- Configuration for File Uploads ---
UPLOAD_FOLDER = "uploads"
ALLOWED_EXTENSIONS = {
    "mp4",
    "avi",
    "mov",
    "mkv",
    "webm",
}  # Add more video extensions as needed
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

# Create the uploads folder if it doesn't exist
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

FEED_COUNT = 4
crowd_processors = [CrowdProcessor() for _ in range(FEED_COUNT)]
is_processing_active = [False] * FEED_COUNT
current_uploaded_video_path = [None] * FEED_COUNT


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def generate_frames(feed):
    """
    Generator function to continuously read, process, and yield video frames.
    """
    global is_processing_active
    processor = crowd_processors[feed]
    if not processor.video_source or not processor.video_source.isOpened():
        print(f"Error: Video source not set or not opened for streaming (feed {feed}).")
        is_processing_active[feed] = False
        return
    while is_processing_active[feed]:
        success, frame = processor.get_frame()
        if not success:
            print(f"Failed to read frame or end of video stream. Stopping feed {feed}.")
            is_processing_active[feed] = False
            break
        processed_frame = processor.process_frame(frame)
        ret, buffer = cv2.imencode(".jpg", processed_frame)
        if not ret:
            continue
        frame_bytes = buffer.tobytes()
        yield (
            b"--frame\r\n" b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
        )
        time.sleep(0.01)
    processor.stop()
    if current_uploaded_video_path[feed] and os.path.exists(current_uploaded_video_path[feed]):
        try:
            os.remove(current_uploaded_video_path[feed])
            print(f"Deleted temporary video: {current_uploaded_video_path[feed]}")
        except Exception as e:
            print(f"Error deleting temporary video {current_uploaded_video_path[feed]}: {e}")
    print(f"Video streaming stopped for feed {feed}.")


@app.route("/")
def index():
    """Render the main HTML page."""
    return render_template("index.html")


@app.route("/video_feed/<int:feed>")
def video_feed(feed):
    """Video streaming route. It generates a stream of MJPEG frames."""
    return Response(
        generate_frames(feed), mimetype="multipart/x-mixed-replace; boundary=frame"
    )


@app.route("/upload_video", methods=["POST"])
def upload_video():
    """Handles video file uploads."""
    global current_uploaded_video_path

    feed = int(request.args.get("feed", 0))  # Get feed index from query parameter

    if "videoFile" not in request.files:
        return jsonify(success=False, message="No file part in the request.")

    file = request.files["videoFile"]

    if file.filename == "":
        return jsonify(success=False, message="No selected file.")

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        # Ensure unique filename to prevent overwriting
        base, ext = os.path.splitext(filename)
        timestamp = int(time.time())
        unique_filename = f"{base}_{timestamp}{ext}"

        filepath = os.path.join(app.config["UPLOAD_FOLDER"], unique_filename)
        try:
            file.save(filepath)
            current_uploaded_video_path[feed] = filepath  # Store path for the correct feed
            return jsonify(
                success=True, message="File uploaded successfully!", filepath=filepath
            )
        except Exception as e:
            return jsonify(success=False, message=f"Error saving file: {e}")
    else:
        return jsonify(success=False, message="File type not allowed.")


@app.route("/start_processing", methods=["POST"])
def start_processing():
    global is_processing_active, current_uploaded_video_path
    data = request.json
    source_type = data.get("source_type")  # 'webcam', 'file', or 'stream'
    source_path = data.get("source_path")
    feed = int(data.get("feed", 0))
    if is_processing_active[feed]:
        return jsonify(success=False, message="Processing already active.")
    actual_source_to_processor = source_path
    if source_type == "file" and current_uploaded_video_path[feed]:
        actual_source_to_processor = current_uploaded_video_path[feed]
    elif source_type == "file" and not current_uploaded_video_path[feed]:
        return jsonify(success=False, message="No video file uploaded yet. Please upload a file first.")
    # For 'stream', just use the provided URL as source_path
    # For 'webcam', use the webcam index
    # For 'file', use the uploaded file path
    if not crowd_processors[feed].set_video_source(source_type, actual_source_to_processor):
        return jsonify(success=False, message=f"Failed to open video source: {actual_source_to_processor}")
    is_processing_active[feed] = True
    print(f"Started processing from {source_type}: {actual_source_to_processor} (feed {feed})")
    return jsonify(success=True, message="Processing started.")


@app.route("/stop_processing", methods=["POST"])
def stop_processing():
    global is_processing_active, current_uploaded_video_path
    data = request.json or {}
    feed = int(data.get("feed", 0))
    is_processing_active[feed] = False
    print(f"Signaled processing to stop for feed {feed}.")
    return jsonify(success=True, message="Processing stop signal sent.")


@app.route("/set_roi", methods=["POST"])
def set_roi():
    data = request.json
    feed = int(request.args.get("feed", 0))
    x_percent = data.get("x")
    y_percent = data.get("y")
    w_percent = data.get("w")
    h_percent = data.get("h")
    crowd_processors[feed].set_roi(x_percent, y_percent, w_percent, h_percent)
    return jsonify(success=True, message="ROI set.")


@app.route("/get_current_stats")
def get_current_stats():
    """Returns current processing statistics as JSON from CrowdProcessor."""
    feed = int(request.args.get("feed", 0))
    stats = crowd_processors[feed].get_latest_stats()
    # Explicitly include alert_message for frontend compatibility
    return jsonify(success=True, alert_message=stats.get("alert"), **stats)


# New route for getting alert history
@app.route("/get_alert_history")
def get_alert_history():
    """Returns the history of triggered alerts."""
    feed = int(request.args.get("feed", 0))
    alerts = crowd_processors[feed].get_alert_history()
    return jsonify(success=True, alerts=alerts)


# New route for getting head count history
@app.route("/get_head_count_history")
def get_head_count_history():
    """Returns the head count history with timestamp, people count, and webcam index (feed)."""
    feed = int(request.args.get("feed", 0))
    history = crowd_processors[feed].get_head_count_history()
    # Add webcam index to each entry
    for entry in history:
        entry["webcam_index"] = feed
    return jsonify(success=True, history=history)


# New route for getting all head count histories
@app.route("/get_all_head_count_histories")
def get_all_head_count_histories():
    """Returns the head count histories for all feeds."""
    all_histories = []
    for feed in range(len(crowd_processors)):
        history = crowd_processors[feed].get_head_count_history()
        for entry in history:
            entry["webcam_index"] = feed
        all_histories.append({"feed": feed, "history": history})
    return jsonify(success=True, all_histories=all_histories)


@app.route("/upload_image", methods=["POST"])
def upload_image():
    feed = int(request.args.get("feed", 0))
    if "imageFile" not in request.files:
        return jsonify(success=False, message="No file part in the request.")
    file = request.files["imageFile"]
    if file.filename == "":
        return jsonify(success=False, message="No selected file.")
    # Save uploaded image
    filename = secure_filename(file.filename)
    base, ext = os.path.splitext(filename)
    timestamp = int(time.time())
    unique_filename = f"{base}_{timestamp}{ext}"
    upload_path = os.path.join(app.config["UPLOAD_FOLDER"], unique_filename)
    file.save(upload_path)
    # Process image
    processor = crowd_processors[feed]
    image = cv2.imread(upload_path)
    if image is None:
        return jsonify(success=False, message="Failed to read uploaded image.")
    # If ROI is set, use it; else, use full image
    if processor.roi_coords:
        x, y, w, h = processor.roi_coords
        roi = image[y:y+h, x:x+w]
        processed = processor.process_frame(image)
    else:
        processed = processor.process_frame(image)
    # Save processed image
    processed_filename = f"processed_{unique_filename}"
    processed_path = os.path.join(app.config["UPLOAD_FOLDER"], processed_filename)
    cv2.imwrite(processed_path, processed)
    # Return URL to processed image
    return jsonify(success=True, processed_image_url=f"/uploads/{processed_filename}")


@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


if __name__ == "__main__":
    # Use threaded=True for development to allow concurrent requests (video feed + API calls)
    app.run(debug=True, threaded=True)
